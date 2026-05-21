const { createCanvas } = require("canvas");
const fs = require("fs");
const path = require("path");

function createIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  const radius = size * 0.15;

  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(size - radius, 0);
  ctx.quadraticCurveTo(size, 0, size, radius);
  ctx.lineTo(size, size - radius);
  ctx.quadraticCurveTo(size, size, size - radius, size);
  ctx.lineTo(radius, size);
  ctx.quadraticCurveTo(0, size, 0, size - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.closePath();

  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, "#4285f4");
  gradient.addColorStop(1, "#34a853");
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.fillStyle = "white";
  ctx.font = `bold ${size * 0.55}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("M", size / 2, size / 2 + size * 0.05);

  const badgeRadius = size * 0.12;
  ctx.beginPath();
  ctx.arc(size * 0.75, size * 0.25, badgeRadius, 0, Math.PI * 2);
  ctx.fillStyle = "#fbbc05";
  ctx.fill();

  ctx.fillStyle = "white";
  ctx.font = `bold ${size * 0.14}px Arial`;
  ctx.fillText("AI", size * 0.75, size * 0.25 + size * 0.02);

  const buffer = canvas.toBuffer("image/png");
  fs.writeFileSync(path.join(__dirname, `icon${size}.png`), buffer);
  console.log(`Created icon${size}.png`);
}

createIcon(16);
createIcon(48);
createIcon(128);
