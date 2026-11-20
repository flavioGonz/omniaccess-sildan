-- Lo que el rastreador informa al conectarse: voltaje del vehiculo y la SIM.
ALTER TABLE "GpsEquipo" ADD COLUMN "voltaje" DOUBLE PRECISION, ADD COLUMN "iccid" TEXT;
