"""Subir un archivo al LXC por el mismo camino que pc.py: SFTP al host y `pct push`.

Existe porque el helper de comandos manda un script por stdin y eso no sirve para un
binario: un bundle de git son sesenta kilobytes que no pueden viajar como texto.

Uso:  PXP=... python3 pf.py <archivo-local> <destino-en-el-lxc>
"""
import paramiko, sys, os, uuid
local, destino = sys.argv[1], sys.argv[2]
c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(os.environ.get("PXH", "172.26.20.200"), username="root",
          password=os.environ["PXP"], timeout=30, banner_timeout=60, auth_timeout=60)
vmid = os.environ.get("VMID", "200")
tmp = "/tmp/up_%s" % uuid.uuid4().hex
sftp = c.open_sftp(); sftp.put(local, tmp); sftp.close()
cmd = f"pct push {vmid} {tmp} {destino} && rm -f {tmp}"
_, o, e = c.exec_command(cmd, timeout=int(os.environ.get("PXT", "300")))
sys.stdout.write(o.read().decode(errors="replace"))
sys.stdout.write(e.read().decode(errors="replace"))
print("EXIT", o.channel.recv_exit_status())
