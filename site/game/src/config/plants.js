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
};

export const STARTING_PLANT_ID = "thornVine";
