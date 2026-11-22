/**
 * La geometría y el horario de las geocercas, para las pantallas.
 *
 * No hay nada escrito acá: es `lib-gps-geocercas.js`, el mismo archivo que usa el receptor, con sus
 * tipos. Una sola cuenta de qué es «adentro» para el que avisa y para el que dibuja.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const geo = require("../../lib-gps-geocercas.js") as {
    metros(aLat: number, aLon: number, bLat: number, bLon: number): number;
    puntosDe(gc: { puntos?: unknown }): [number, number][] | null;
    esPoligono(gc: { puntos?: unknown }): boolean;
    dentroDe(gc: FormaDeCerca, lat: number, lon: number): boolean;
    bordeDe(gc: FormaDeCerca, lat: number, lon: number): number;
    circuloDe(puntos: unknown): { lat: number; lon: number; radio: number } | null;
    aplicaA(gc: { imeis?: string[] | null }, imei: string): boolean;
    avisaCruce(gc: { avisa?: string | null }, entra: boolean): boolean;
    leerHorario(x: unknown): HorarioCerca | null;
    enHorario(horario: unknown, fecha: Date, zona?: string): boolean;
    rotuloDeHorario(horario: unknown): string;
};

export type HorarioCerca = { dias: number[]; desde: string; hasta: string };
export type FormaDeCerca = { lat: number; lon: number; radio: number; puntos?: [number, number][] | null };
export type AvisaCerca = "ambos" | "entra" | "sale";

export const { metros, puntosDe, esPoligono, dentroDe, bordeDe, circuloDe, aplicaA, avisaCruce, leerHorario, enHorario, rotuloDeHorario } = geo;

/** Cuántos vértices como mucho: un predio se dibuja con una docena; más es un dedo que se quedó apretado. */
export const VERTICES_MAX = 60;
