const PhaserRef = window.Phaser;

if (!PhaserRef) {
  throw new Error("Phaser failed to load before the Rootline Defense bootstrap ran.");
}

export default PhaserRef;
