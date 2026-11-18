"""Manual SSA serial console. Launches disconnected; never sends startup data."""
import argparse
import json
import os
import sys
from pathlib import Path
import queue
import threading
import tkinter as tk
from tkinter import filedialog, scrolledtext, ttk
from probe_core import LineAssembler, SessionLog, prepare_payload, transmit_once, visible

ROOT = Path(__file__).resolve().parent.parent

class ProbeApp:
    def __init__(self, window):
        self.window = window
        window.title("SSA Command Investigator — disconnected")
        window.geometry("1040x740")
        window.minsize(800, 620)
        self.port = None
        self.logger = None
        self.reader = None
        self.stop_reader = threading.Event()
        self.events = queue.Queue()
        self.assembler = LineAssembler()
        self.session_path = None
        self.tx_bytes = self.rx_bytes = 0
        self.shutting_down = False
        self.offline_rows = []
        self.offline_job = None
        self.setup()
        self.refresh_ports()
        self.update_preview()
        self.window.after(60, self.poll)
        self.window.protocol("WM_DELETE_WINDOW", self.close)

    def setup(self):
        pad = ttk.Frame(self.window, padding=18)
        pad.pack(fill="both", expand=True)
        ttk.Label(pad, text="SSA Command Investigator", font=("Segoe UI", 20, "bold")).pack(anchor="w")
        ttk.Label(pad, text="One manual send at a time · exact bytes · no automatic startup commands").pack(anchor="w", pady=(3,12))
        connection = ttk.LabelFrame(pad, text="Connection — 9600 baud · 8N1 · no flow control", padding=10)
        connection.pack(fill="x")
        self.port_name = tk.StringVar(value="COM4")
        self.port_choice = ttk.Combobox(connection, textvariable=self.port_name, width=18)
        self.port_choice.grid(row=0, column=0, padx=(0,8))
        self.refresh_button = ttk.Button(connection, text="Refresh ports", command=self.refresh_ports)
        self.refresh_button.grid(row=0,column=1,padx=4)
        self.dtr = tk.BooleanVar(value=True)
        self.rts = tk.BooleanVar(value=True)
        self.dtr_check = ttk.Checkbutton(connection,text="DTR on",variable=self.dtr)
        self.dtr_check.grid(row=0,column=2,padx=9)
        self.rts_check = ttk.Checkbutton(connection,text="RTS on",variable=self.rts)
        self.rts_check.grid(row=0,column=3,padx=9)
        self.connect_button = ttk.Button(connection,text="Connect",command=self.toggle_connection)
        self.connect_button.grid(row=0,column=4,padx=8)
        self.ready = tk.BooleanVar(value=False)
        self.ready_check = ttk.Checkbutton(connection,
            text="SSA is closed; tester is unloaded and clear. Opening the port may change control signals.",
            variable=self.ready)
        self.ready_check.grid(row=1,column=0,columnspan=5,sticky="w",pady=(10,0))
        self.status = tk.StringVar(value="Disconnected — no port opened")
        ttk.Label(pad,textvariable=self.status,wraplength=970).pack(anchor="w",pady=10)
        send = ttk.LabelFrame(pad,text="Transmit — nothing is sent until you click Send once",padding=10)
        send.pack(fill="x")
        self.command = tk.StringVar()
        self.command_entry = ttk.Entry(send,textvariable=self.command,width=35)
        self.command_entry.grid(row=0,column=0,sticky="ew",padx=(0,8))
        self.format = tk.StringVar(value="ASCII")
        ttk.Combobox(send,textvariable=self.format,values=("ASCII","Hex"),state="readonly",width=8).grid(row=0,column=1,padx=4)
        ttk.Label(send,text="Append").grid(row=0,column=2,padx=(10,3))
        self.ending = tk.StringVar(value="None")
        ttk.Combobox(send,textvariable=self.ending,values=("None","CR","LF","CRLF"),state="readonly",width=7).grid(row=0,column=3,padx=4)
        self.send_button = ttk.Button(send,text="Send once",command=self.send,state="disabled")
        self.send_button.grid(row=0,column=4,padx=(10,0))
        send.columnconfigure(0,weight=1)
        self.preview = tk.StringVar()
        ttk.Label(send,textvariable=self.preview,wraplength=960).grid(row=1,column=0,columnspan=5,sticky="w",pady=(9,0))
        ttk.Label(send,text="ASCII escapes: \\r \\n \\t \\xHH. No default line ending. T is blocked in every format.").grid(row=2,column=0,columnspan=5,sticky="w",pady=(6,0))
        self.note = tk.StringVar()
        notes = ttk.Frame(pad)
        notes.pack(fill="x",pady=10)
        ttk.Label(notes,text="Observation").pack(side="left",padx=(0,8))
        ttk.Entry(notes,textvariable=self.note).pack(side="left",fill="x",expand=True)
        ttk.Button(notes,text="Log note",command=self.log_note).pack(side="left",padx=(8,0))
        self.display = scrolledtext.ScrolledText(pad,font=("Consolas",10),height=17,state="disabled",wrap="word")
        self.display.pack(fill="both",expand=True)
        bottom = ttk.Frame(pad)
        bottom.pack(side="bottom",fill="x",pady=(10,0),before=self.display)
        self.replay_button = ttk.Button(bottom,text="Replay saved capture (offline)",command=self.replay)
        self.replay_button.pack(side="left")
        ttk.Button(bottom,text="Save visible transcript…",command=self.save_transcript).pack(side="left",padx=8)
        self.counter = tk.StringVar(value="TX 0 bytes · RX 0 bytes")
        ttk.Label(bottom,textvariable=self.counter).pack(side="right")
        self.log_label = tk.StringVar(value="New session logs will be written to sessions/ (not automatically committed).")
        ttk.Label(pad,textvariable=self.log_label,wraplength=970).pack(anchor="w",pady=(8,0),before=self.display)
        for var in (self.command,self.format,self.ending):
            var.trace_add("write",lambda *_:self.update_preview())
        self.write("INFO","Disconnected. No handshake or command has been sent.")

    def write(self, kind, text):
        self.display.configure(state="normal")
        self.display.insert("end",f"{kind:>9}  {text}\n")
        self.display.see("end")
        self.display.configure(state="disabled")

    def update_preview(self):
        try:
            payload=prepare_payload(self.command.get(),self.format.get(),self.ending.get())
            self.preview.set(f"{len(payload)} bytes | HEX {payload.hex(' ')} | TEXT {visible(payload)}")
            enabled=self.port is not None
        except ValueError as error:
            self.preview.set(str(error))
            enabled=False
        self.send_button.configure(state="normal" if enabled else "disabled")

    def refresh_ports(self):
        if self.port is not None:
            return
        try:
            from serial.tools import list_ports
            devices=list(list_ports.comports())
            self.port_choice.configure(values=[p.device for p in devices])
            for p in devices:
                self.write("PORT",f"{p.device} — {p.description}")
            if devices and self.port_name.get() not in [p.device for p in devices]:
                self.port_name.set(devices[0].device)
        except ImportError:
            self.write("INFO","pyserial is not installed. Offline replay still works. See docs/python-investigator.txt.")
        except Exception as error:
            self.write("ERROR",str(error))

    def controls(self, connected):
        for widget in (self.port_choice,self.refresh_button,self.dtr_check,self.rts_check,self.ready_check):
            widget.configure(state="disabled" if connected else "normal")
        self.replay_button.configure(state="disabled" if connected else "normal")
        self.connect_button.configure(text="Disconnect" if connected else "Connect")
        self.update_preview()

    def toggle_connection(self):
        if self.port is not None:
            self.disconnect()
            return
        if self.offline_job is not None:
            self.write("INFO","Wait for offline replay to finish before connecting.")
            return
        if not self.ready.get():
            self.write("INFO","Check the readiness box before connecting. No port has been opened.")
            return
        port = None
        try:
            import serial
            self.begin_log("live",{"port":self.port_name.get(),"baud":9600,"data_bits":8,
                "parity":"none","stop_bits":1,"dtr":self.dtr.get(),"rts":self.rts.get(),
                "xonxoff":False,"rtscts":False,"dsrdtr":False})
            # Construct closed so control-line preferences are set before open.
            # The driver/OS may still produce a control-line transition.
            port=serial.Serial(port=None,baudrate=9600,bytesize=serial.EIGHTBITS,
                parity=serial.PARITY_NONE,stopbits=serial.STOPBITS_ONE,
                timeout=0.1,write_timeout=1,xonxoff=False,rtscts=False,dsrdtr=False)
            port.dtr=self.dtr.get()
            port.rts=self.rts.get()
            port.port=self.port_name.get().strip()
            self.logger.event("open_attempt")
            port.open()
            self.logger.event("opened",startup_bytes_sent=0)
            self.port=port
            self.stop_reader.clear()
            self.assembler=LineAssembler()
            self.controls(True)
            self.status.set("CONNECTED — listening only until Send once is clicked")
            self.window.title("SSA Command Investigator — "+port.port)
            self.reader=threading.Thread(target=self.read_loop,args=(port,self.logger),daemon=True)
            self.reader.start()
            self.write("INFO","Port opened. No serial bytes sent. DTR/RTS changes may affect the tester.")
        except Exception as error:
            if port is not None:
                port.close()
            self.write("ERROR","Connection failed: "+str(error))
            if self.logger is not None:
                try:self.logger.event("open_error",error=str(error))
                finally:self.logger.close();self.logger=None
            self.status.set("Disconnected — connection failed")
            self.controls(False)

    def begin_log(self,kind,metadata):
        if self.logger is not None:
            self.logger.close()
        self.logger=SessionLog(ROOT/"sessions",kind,metadata)
        self.session_path=self.logger.path
        self.tx_bytes=self.rx_bytes=0
        self.log_label.set(str(self.session_path))
        self.write("LOG",str(self.session_path))

    def read_loop(self,port,logger):
        try:
            while not self.stop_reader.is_set():
                data=port.read(max(1,min(port.in_waiting,4096)))
                if data:
                    row=logger.event("rx",data)
                    self.events.put(("rx",data,row["elapsed_s"]))
        except Exception as error:
            if not self.stop_reader.is_set():
                self.events.put(("error",str(error),None))

    def poll(self):
        try:
            while True:
                kind,data,elapsed=self.events.get_nowait()
                if kind=="rx":
                    self.show_received(data,elapsed)
                else:
                    self.write("ERROR",data)
                    self.disconnect("Read or logging failure; connection closed")
        except queue.Empty:
            pass
        if not self.shutting_down:
            self.window.after(60,self.poll)

    def show_received(self,data,elapsed):
        self.rx_bytes+=len(data)
        self.write("RX",f"+{elapsed:.3f}s  {len(data)} bytes | {data.hex(' ')} | {visible(data)}")
        for line in self.assembler.feed(data):
            self.write("RECORD",visible(line)+" <CR>")
        self.counter.set(f"TX {self.tx_bytes} bytes · RX {self.rx_bytes} bytes")

    def send(self):
        if self.port is None:
            return
        try:
            payload=prepare_payload(self.command.get(),self.format.get(),self.ending.get())
        except ValueError as error:
            self.write("BLOCKED",str(error))
            return
        try:
            transmit_once(self.port,self.logger,payload)
            self.tx_bytes+=len(payload)
            self.write("TX",f"{len(payload)} bytes | {payload.hex(' ')} | {visible(payload)}")
            self.counter.set(f"TX {self.tx_bytes} bytes · RX {self.rx_bytes} bytes")
            self.command.set("")  # Prevent accidental duplicate sends.
        except Exception as error:
            self.write("ERROR",str(error)+" Delivery may be partial/unknown. No retry made.")
            self.disconnect("Write or logging failure; connection closed")

    def log_note(self):
        text=self.note.get().strip()
        if not text:return
        try:
            if self.logger is not None:self.logger.event("note",note=text)
            self.write("NOTE",text)
            self.note.set("")
        except Exception as error:
            self.write("ERROR","Could not save note: "+str(error))
            if self.port is not None:self.disconnect("Logging failure")

    def disconnect(self,reason="Disconnected"):
        self.stop_reader.set()
        port=self.port
        self.port=None
        if self.reader is not None:
            self.reader.join(timeout=1)
            if self.reader.is_alive():
                if port is not None:port.close()
                self.reader.join(timeout=1)
            self.reader=None
        # Drain queued receive data before resetting parser or counters.
        try:
            while True:
                kind,data,elapsed=self.events.get_nowait()
                if kind=="rx":self.show_received(data,elapsed)
                else:self.write("ERROR",data)
        except queue.Empty:pass
        if port is not None:
            try:port.close()
            except Exception as error:self.write("ERROR","Port close: "+str(error))
        if self.logger is not None:
            try:
                self.logger.event("closed",pending_hex=bytes(self.assembler.pending).hex(),
                                  tx_bytes=self.tx_bytes,rx_bytes=self.rx_bytes,reason=reason)
            except Exception as error:self.write("ERROR","Final log event: "+str(error))
            finally:self.logger.close();self.logger=None
        self.controls(False)
        self.status.set(reason)
        self.window.title("SSA Command Investigator — disconnected")
        self.write("INFO",reason+". No serial shutdown command was sent.")

    def replay(self):
        if self.port is not None or self.offline_job is not None:return
        try:
            data=(ROOT/"evidence/2026-11-17/ssa1000-device-to-host.txt").read_bytes()
            self.begin_log("offline",{"source":"ssa1000-device-to-host.txt",
                "timing":"fast demonstration, not recorded timing","hardware_opened":False})
            self.assembler=LineAssembler()
            self.offline_rows=[data[i:i+37] for i in range(0,len(data),37)]
            self.status.set("OFFLINE CAPTURE REPLAY — no hardware connection")
            self.replay_button.configure(state="disabled")
            self.write("INFO","Replaying the real saved stream in 37-byte chunks, at accelerated demonstration speed.")
            self.replay_step()
        except Exception as error:
            self.write("ERROR",str(error))
            if self.logger is not None:self.logger.close();self.logger=None
            self.offline_job=None
            self.replay_button.configure(state="normal")

    def replay_step(self):
        self.offline_job=None
        try:
            if self.offline_rows:
                data=self.offline_rows.pop(0)
                row=self.logger.event("offline_rx",data)
                self.show_received(data,row["elapsed_s"])
                self.offline_job=self.window.after(35,self.replay_step)
            else:
                self.logger.event("offline_complete",rx_bytes=self.rx_bytes,
                    pending_hex=bytes(self.assembler.pending).hex())
                self.logger.close();self.logger=None
                self.status.set("Offline replay complete — 1,445 source bytes; no hardware opened")
                self.replay_button.configure(state="normal")
        except Exception as error:
            self.write("ERROR","Offline replay/logging failed: "+str(error))
            if self.logger is not None:self.logger.close();self.logger=None
            self.offline_job=None
            self.replay_button.configure(state="normal")

    def save_transcript(self):
        filename=filedialog.asksaveasfilename(parent=self.window,title="Save visible transcript",
            defaultextension=".txt",filetypes=[("Text files","*.txt")],initialdir=str(ROOT/"sessions"))
        if filename:
            try:Path(filename).write_text(self.display.get("1.0","end-1c"),encoding="utf-8")
            except OSError as error:self.write("ERROR",str(error))

    def close(self):
        self.shutting_down=True
        if self.offline_job is not None:
            self.window.after_cancel(self.offline_job)
            self.offline_job=None
        self.disconnect("Window closed")
        self.window.destroy()

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list-ports",action="store_true",help="List serial ports without opening them.")
    args=parser.parse_args()
    if args.list_ports:
        try:
            from serial.tools import list_ports
        except ImportError:
            parser.error("Install the dependency from requirements-probe.txt first.")
        for port in list_ports.comports():
            print(port.device,port.description,port.hwid)
        return
    # Some packaged Python runtimes need project-local Tcl/Tk resource paths.
    runtime_tcl = Path(sys.prefix) / "tcl"
    if (runtime_tcl / "tcl8.6" / "init.tcl").is_file():
        os.environ.setdefault("TCL_LIBRARY", str(runtime_tcl / "tcl8.6"))
    if (runtime_tcl / "tk8.6" / "tk.tcl").is_file():
        os.environ.setdefault("TK_LIBRARY", str(runtime_tcl / "tk8.6"))
    root=tk.Tk()
    ttk.Style().theme_use("clam")
    ProbeApp(root)
    root.mainloop()

if __name__=="__main__":
    main()
