import { describe, expect, it } from 'vitest';
import { airportSchema, formatAirportLabel, matchAirports, normalizeSearchText } from '../src';
import { sampleAirports } from './fixtures';

const codes = (query: string, limit?: number) =>
  matchAirports(query, sampleAirports, limit).map((airport) => airport.code);

describe('matchAirports', () => {
  it('returns hubs first, then cities alphabetically, for an empty query', () => {
    expect(codes('')).toEqual(['CEB', 'MNL', 'SGN', 'KUL', 'HND', 'NRT']);
  });

  it('ranks an exact airport code first', () => {
    expect(codes('nrt')[0]).toBe('NRT');
    expect(codes('NRT')[0]).toBe('NRT');
  });

  it('matches city names by prefix and returns every airport in the city', () => {
    expect(codes('tok')).toEqual(['HND', 'NRT']);
  });

  it('matches words inside airport names and countries', () => {
    expect(codes('narita')).toEqual(['NRT']);
    expect(codes('japan')).toEqual(['HND', 'NRT']);
    expect(codes('mactan')).toEqual(['CEB']);
  });

  it('ignores accents and letter case', () => {
    expect(codes('tan son')).toEqual(['SGN']);
    expect(normalizeSearchText('  Tân Sơn Nhất ')).toBe('tan son nhat');
    expect(normalizeSearchText('Đà Nẵng')).toBe('da nang');
  });

  it('matches multi-word city names', () => {
    expect(codes('kuala l')).toEqual(['KUL']);
    expect(codes('ho chi')).toEqual(['SGN']);
  });

  it('returns nothing when no field matches', () => {
    expect(codes('zzz')).toEqual([]);
  });

  it('respects the result limit', () => {
    expect(codes('', 2)).toHaveLength(2);
  });

  it('formats a readable label', () => {
    expect(formatAirportLabel(sampleAirports[0]!)).toBe('Manila (MNL)');
  });
});

describe('airportSchema', () => {
  it('accepts valid airports', () => {
    for (const airport of sampleAirports) expect(airportSchema.parse(airport)).toEqual(airport);
  });

  it('rejects lower-case or malformed codes', () => {
    expect(airportSchema.safeParse({ ...sampleAirports[0], code: 'mnl' }).success).toBe(false);
    expect(airportSchema.safeParse({ ...sampleAirports[0], code: 'MNLA' }).success).toBe(false);
  });
});
