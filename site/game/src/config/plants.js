export const PLANT_DEFINITIONS = {
  thornVine: {
    id: "thornVine",
    label: "Thorn Vine",
    description: "Fires thorn bolts down a single lane. Cheap, steady, and best when planted where pressure is actually coming.",
    textureKey: "thorn-vine",
    cost: 50,
    maxHealth: 34,
    cadenceMs: 900,
    initialCooldownMs: 405,
    projectileSpeed: 412,
    projectileDamage: 14,
    projectileRadius: 7,
    projectileTextureKey: "thorn-projectile",
    displayWidth: 48,
    displayHeight: 52,
  },
  brambleSpear: {
    id: "brambleSpear",
    label: "Bramble Spear",
    description:
      "Launches piercing bolts that pass through all enemies in a lane, damaging each once. Slower and pricier, but devastating against clustered foes.",
    textureKey: "bramble-spear",
    cost: 35,
    maxHealth: 26,
    cadenceMs: 1400,
    initialCooldownMs: 700,
    projectileSpeed: 280,
    projectileDamage: 18,
    projectileRadius: 6,
    piercing: true,
    projectileTextureKey: "bramble-spear-projectile",
    displayWidth: 48,
    displayHeight: 52,
  },
};

export const STARTING_PLANT_ID = "thornVine";
