export function createInputController(scene) {
  const cursors = scene.input.keyboard.createCursorKeys();
  const keys = scene.input.keyboard.addKeys("W,A,S,D");

  return {
    getVector() {
      let x = 0;
      let y = 0;

      if (cursors.left.isDown || keys.A.isDown) x -= 1;
      if (cursors.right.isDown || keys.D.isDown) x += 1;
      if (cursors.up.isDown || keys.W.isDown) y -= 1;
      if (cursors.down.isDown || keys.S.isDown) y += 1;

      if (x === 0 && y === 0) {
        return { x: 0, y: 0 };
      }

      const magnitude = Math.hypot(x, y) || 1;
      return { x: x / magnitude, y: y / magnitude };
    },
  };
}
