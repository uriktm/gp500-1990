// 1990-inspired 500cc 2-Stroke Grand Prix bikes (Original fictional roster)

export const BIKES = [
  {
    id: 'akagi',
    name: 'Akagi V4-500',
    number: 1,
    team: 'Apex Red Racing',
    colorPrimary: 0xd91424,
    colorSecondary: 0xffffff,
    colorAccent: 0x151515,
    colorPrimaryHex: '#d91424',
    colorSecondaryHex: '#ffffff',
    colorAccentHex: '#151515',
    timbre: {
      baseFreq: 110,
      harmonicRatio: 2.0,
      filterFreq: 1400
    },
    stats: {
      maxSpeed: 84.5, // ~304 km/h
      accel: 1.0,
      leanRate: 1.06,
      braking: 1.02,
      grip: 1.04
    }
  },
  {
    id: 'shiden',
    name: 'Shiden NSR-V',
    number: 4,
    team: 'Factory Blue Gold',
    colorPrimary: 0x1648b8,
    colorSecondary: 0xf5c542,
    colorAccent: 0xffffff,
    colorPrimaryHex: '#1648b8',
    colorSecondaryHex: '#f5c542',
    colorAccentHex: '#ffffff',
    timbre: {
      baseFreq: 102,
      harmonicRatio: 1.5,
      filterFreq: 1250
    },
    stats: {
      maxSpeed: 87.5, // ~315 km/h
      accel: 1.07,
      leanRate: 0.96,
      braking: 0.98,
      grip: 0.98
    }
  },
  {
    id: 'kaze',
    name: 'Kaze RGV-500',
    number: 34,
    team: 'Striker Cyan Red',
    colorPrimary: 0x00a8e8,
    colorSecondary: 0xe62222,
    colorAccent: 0xffffff,
    colorPrimaryHex: '#00a8e8',
    colorSecondaryHex: '#e62222',
    colorAccentHex: '#ffffff',
    timbre: {
      baseFreq: 118,
      harmonicRatio: 2.2,
      filterFreq: 1550
    },
    stats: {
      maxSpeed: 83.0, // ~299 km/h
      accel: 0.99,
      leanRate: 1.10,
      braking: 1.08,
      grip: 1.02
    }
  },
  {
    id: 'corsa',
    name: 'Corsa 500 Italia',
    number: 27,
    team: 'Scuderia Corsa',
    colorPrimary: 0xb80f1a,
    colorSecondary: 0x181818,
    colorAccent: 0xf0d040,
    colorPrimaryHex: '#b80f1a',
    colorSecondaryHex: '#181818',
    colorAccentHex: '#f0d040',
    timbre: {
      baseFreq: 96,
      harmonicRatio: 1.75,
      filterFreq: 1180
    },
    stats: {
      maxSpeed: 86.0, // ~310 km/h
      accel: 1.04,
      leanRate: 1.0,
      braking: 1.02,
      grip: 1.0
    }
  }
];

export function getBikeById(id) {
  return BIKES.find((b) => b.id === id) || BIKES[0];
}
