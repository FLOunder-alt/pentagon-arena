/* Gameplay tuning. Change numbers here to rebalance the game. */
module.exports = {
  TICK_RATE: 30,
  MOVE_SPEED: 220,
  GHOST_SPEED: 320,
  ARROW_SPEED: 650,
  ARROW_LIFE: 1.5,          // seconds

  DASH_SPEED: 1000,
  DASH_TIME: 0.15,          // seconds (about 150 px)
  DASH_COOLDOWN: 4000,      // ms

  // Storm: each phase waits `wait` seconds, then shrinks to radius `r` over `shrink` seconds.
  // `dps` is the damage per second dealt outside the circle during that phase.
  STORM_START_RADIUS: 930,  // covers the whole pentagon
  STORM_PHASES: [
    { wait: 30, shrink: 20, r: 600, dps: 2 },
    { wait: 20, shrink: 15, r: 380, dps: 4 },
    { wait: 15, shrink: 15, r: 220, dps: 7 },
    { wait: 12, shrink: 12, r: 90, dps: 10 },
    { wait: 10, shrink: 15, r: 0, dps: 15 }
  ],

  POWERUP_INTERVAL: 25000,  // ms
  POWERUP_BATCH: 5,
  POWERUP_MAX: 14,          // most allowed on the map at once
  POWERUP_WEIGHTS: { power: 2, agility: 2, food: 3, shield: 2, haste: 1.5, multi: 1.5, ricochet: 1.5 },
  FOOD_HEAL: 10,
  SHIELD_GAIN: 30,
  SHIELD_MAX: 60,
  HASTE_MULT: 1.4,
  HASTE_TIME: 8000,
  MULTI_TIME: 10000,
  MULTI_SPREAD: 0.17,       // radians between the three arrows
  RICOCHET_TIME: 10000,
  RICOCHET_BOUNCES: 2
};
