"""Correr un script de bash dentro del LXC de OmniAccess, desde afuera del host.

El script entra por STDIN, viaja por SFTP al host Proxmox y se ejecuta con `pct exec`.
No hay SSH directo al contenedor a propósito: el LXC no expone puerto 22.

Uso:
    export PXP=<clave de root del host>     # NUNCA en un archivo versionado
    export PXT=90                           # segundos de tope, opcional
    cat <<'PCEOF' | timeout 150 python3 pc.py
    cd /opt/OmniAccess && git log --oneline -1
    PCEOF

Variables: PXH (host, por defecto 172.26.20.200), VMID (por defecto 200), PXT (tope).
"""
import paramiko, sys, os, uuid
c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(os.environ.get("PXH", "172.26.20.200"), username="root",
          password=os.environ["PXP"], timeout=30, banner_timeout=60, auth_timeout=60)
vmid = os.environ.get("VMID", "200")
script = sys.stdin.read()
tmp = "/tmp/sc_%s.sh" % uuid.uuid4().hex
sftp = c.open_sftp()
with sftp.open(tmp, "w") as f:
    f.write(script)
sftp.close()
cmd = (f"pct push {vmid} {tmp} {tmp} >/dev/null 2>&1 && "
       f"pct exec {vmid} -- bash -lc 'bash {tmp}; rm -f {tmp}'; rm -f {tmp}")
_, o, e = c.exec_command(cmd, timeout=int(os.environ.get("PXT", "300")))
sys.stdout.write(o.read().decode(errors="replace"))
sys.stdout.write(e.read().decode(errors="replace"))
print("EXIT", o.channel.recv_exit_status())
