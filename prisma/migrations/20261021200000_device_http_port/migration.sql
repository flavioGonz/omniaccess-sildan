-- Puerto HTTP/ISAPI de cada equipo (vacío = 80): NVR y cámaras con la web en otro puerto.
ALTER TABLE "Device" ADD COLUMN "httpPort" INTEGER;
