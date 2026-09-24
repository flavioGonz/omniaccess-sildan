-- El modo de disparo con el que la cámara vivió ese minuto.
--
-- Sin esto no había forma de ver desde la aplicación que una cámara estaba corriendo en
-- el respaldo por escena en vez de dispararse por aviso. Medido sobre cinco días de log,
-- las dos cámaras de San Nicolás pasaron 48,5 horas así —el 20% del tiempo— y produjeron
-- 19 de las 975 lecturas: el 2%. La cámara figuraba en línea todo ese tiempo.
--
-- Con treinta cámaras eso no lo nota nadie mirando un log.
ALTER TABLE "TrackingCamaraMuestra" ADD COLUMN "modo" TEXT;

-- Cuántas veces se reabrió el flujo de avisos en ese minuto. Un número que sube sin parar
-- es el síntoma de la cadena de reintentos que se multiplicaba.
ALTER TABLE "TrackingCamaraMuestra" ADD COLUMN "reconexiones" INTEGER NOT NULL DEFAULT 0;
