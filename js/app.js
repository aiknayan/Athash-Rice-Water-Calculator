/**
 * Panasonic SR-DL184 Rice & Water Calculator
 * Ultra-clean, interactive UI controller with realistic simultaneous multi-cup gravity waterfall animation.
 * Shows all N full cups at a time, tilting gradually down as they empty, then pours any remaining partial cup later.
 */

const CUP_CAPACITY_ML = 160;
const WATER_RATIO = 2.75; // 880 ml (5.5 cups) water for 2 cups rice (440 ml/cup)
const CUPS_PER_LINE = 6.5 / 4; // 1.625 cups of water per pot line (Real pot: 2 cups rice + 6.5 cups water fills Line 4)
const CHEATSHEET_DATA = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0];

let selectedRiceCups = 2.0;
let activePourSequenceId = 0;
let isPouring = false;

/**
 * Calculates exact water requirements based on rice cups
 */
function calculateWater(riceCups) {
  const riceMl = Math.round(riceCups * CUP_CAPACITY_ML);
  const totalWaterMl = Math.round(riceMl * WATER_RATIO);
  const totalWaterCups = parseFloat((totalWaterMl / CUP_CAPACITY_ML).toFixed(2));
  const fullCups = Math.floor(totalWaterMl / CUP_CAPACITY_ML);
  const remMl = totalWaterMl % CUP_CAPACITY_ML;

  let partialText = "";
  let targetMark = remMl;
  let targetLabel = "";

  if (remMl === 0) {
    partialText = "";
    targetLabel = "FULL 160";
    targetMark = 160;
  } else if (remMl === 40) {
    partialText = "1 cup to 40 (¼ line)";
    targetLabel = "FILL TO 40 (¼)";
  } else if (remMl === 80) {
    partialText = "1 cup to 80 (½ line)";
    targetLabel = "FILL TO 80 (½)";
  } else if (remMl === 120) {
    partialText = "1 cup to 120 (¾ line)";
    targetLabel = "FILL TO 120 (¾)";
  } else {
    partialText = `1 cup to ${remMl} ml`;
    targetLabel = `FILL TO ${remMl}`;
  }

  let summary = "";
  if (fullCups > 0 && remMl > 0) {
    summary = `${fullCups} Full Cup${fullCups > 1 ? 's' : ''} + ${partialText}`;
  } else if (fullCups > 0) {
    summary = `${fullCups} Full Cup${fullCups > 1 ? 's' : ''} (160 line)`;
  } else {
    summary = partialText || "0 Cups";
  }

  const potLineNum = totalWaterCups / CUPS_PER_LINE;
  const potGaugeLine = potLineNum.toFixed(1);

  return {
    riceCups,
    riceMl,
    totalWaterMl,
    totalWaterCups,
    totalWaterLiters: (totalWaterMl / 1000).toFixed(2),
    fullCups,
    remMl,
    targetMark,
    targetLabel,
    partialText,
    summary,
    potGaugeLine
  };
}

const POT_SCALE_LINES = [
  { num: 1, y: 294 },
  { num: 2, y: 273 },
  { isNotch: true, elId: 'potNotch3', y: 252 },
  { num: 4, y: 231 },
  { isNotch: true, elId: 'potNotch5', y: 210 },
  { num: 6, y: 189 },
  { isNotch: true, elId: 'potNotch7', y: 168 },
  { num: 8, y: 147 },
  { isNotch: true, elId: 'potNotch9', y: 126 },
  { num: 10, y: 105 }
];

/**
 * Updates the glow effect on pot gauge lines:
 * Whenever water reaches or crosses a line, that number & line light up with the glowing cyan effect!
 */
function updatePotGaugeLines(currentWaterY) {
  POT_SCALE_LINES.forEach(item => {
    // Water has crossed or reached this line if currentWaterY <= item.y + 2
    const isCrossed = currentWaterY <= (item.y + 2);

    if (item.isNotch) {
      const notchEl = document.getElementById(item.elId);
      if (notchEl) {
        if (isCrossed) notchEl.classList.add('active-pot-line');
        else notchEl.classList.remove('active-pot-line');
      }
    } else {
      const lineEl = document.getElementById(`potLine${item.num}`);
      const textEl = document.getElementById(`potText${item.num}`);
      if (lineEl && textEl) {
        if (isCrossed) {
          lineEl.classList.add('active-pot-line');
          textEl.classList.add('active-pot-line');
        } else {
          lineEl.classList.remove('active-pot-line');
          textEl.classList.remove('active-pot-line');
        }
      }
    }
  });
}

/**
 * Updates the Water HUD badge position with collision avoidance against the Rice HUD badge.
 * Guarantees that at small amounts (0.5 cup or less), the Water badge and Rice badge never overlap!
 */
function updateWaterHudBadge(actualWaterY, riceY, currentWaterMl) {
  const svgHudWater = document.getElementById('svgHudWater');
  const svgHudWaterText = document.getElementById('svgHudWaterText');
  const svgHudWaterDot = document.getElementById('svgHudWaterDot');
  const svgHudWaterLine = document.getElementById('svgHudWaterLine');

  if (!svgHudWater) return;

  // Each badge is 26px high. Keep at least 32px center-to-center clearance so they never collide!
  const minClearance = 32;
  const hudY = Math.min(actualWaterY, riceY - minClearance);
  const deltaY = actualWaterY - hudY;

  svgHudWater.setAttribute('transform', `translate(0, ${hudY.toFixed(1)})`);

  if (svgHudWaterDot) {
    svgHudWaterDot.setAttribute('cy', deltaY.toFixed(1));
  }
  if (svgHudWaterLine) {
    svgHudWaterLine.setAttribute('y2', deltaY.toFixed(1));
  }
  if (svgHudWaterText) {
    svgHudWaterText.textContent = `💧 Water: ${Math.round(currentWaterMl)} ml`;
  }
}

/**
 * Executes the two-phase pouring routine matching user draft (Image 3):
 * Phase 1: Shows ALL N full cups at a time in an arched bouquet/fan cluster centered above the pot.
 *          Cups are realistically sized (proportional to the pot) and slowly dip down past horizontal
 *          as liquid completely empties, with smooth parabolic streams and real cascading liquid droplets.
 * Phase 2: If there's a remaining partial cup, 1 cup appears at top center, filled to that mark, and pours later.
 * When finished, all cups and streams vanish immediately and cleanly without lingering.
 */
function runSimultaneousMultiCupPour(data) {
  const potSvg = document.getElementById('potSvg');
  const layer = document.getElementById('svgPourAnimationLayer');
  const dynGroup = document.getElementById('svgDynamicPourGroup');
  const svgPotWaterRect = document.getElementById('svgPotWaterRect');
  const svgPotWaterLine = document.getElementById('svgPotWaterLine');
  const svgHudWater = document.getElementById('svgHudWater');
  const svgHudWaterText = document.getElementById('svgHudWaterText');

  if (!potSvg || !layer || !dynGroup) return;

  const seqId = ++activePourSequenceId;
  isPouring = true;

  // Geometry calculations: real pot calibrated (2c rice + 6.5c water = Line 4)
  const riceHeight = Math.min(65, Math.max(12, data.riceCups * 13));
  const riceY = 315 - riceHeight;
  const potLineNum = data.totalWaterCups / CUPS_PER_LINE;
  const targetWaterY = Math.max(70, 315 - (potLineNum * 21));
  const totalWaterRise = riceY - targetWaterY;

  const fullVolume = data.fullCups * CUP_CAPACITY_ML;
  const hasFull = data.fullCups > 0;
  const hasRem = data.remMl > 0;

  potSvg.classList.add('pouring-in-progress');
  layer.style.opacity = '1';

  // Pot water begins empty at the rice bed
  if (svgPotWaterRect) {
    svgPotWaterRect.setAttribute('y', riceY);
    svgPotWaterRect.setAttribute('height', 0);
  }
  if (svgPotWaterLine) {
    svgPotWaterLine.setAttribute('y1', riceY);
    svgPotWaterLine.setAttribute('y2', riceY);
  }
  updateWaterHudBadge(riceY, riceY, 0);

  function finishEverything() {
    isPouring = false;
    potSvg.classList.remove('pouring-in-progress');

    if (svgPotWaterRect) {
      svgPotWaterRect.setAttribute('y', targetWaterY);
      svgPotWaterRect.setAttribute('height', riceY - targetWaterY);
    }
    if (svgPotWaterLine) {
      svgPotWaterLine.setAttribute('y1', targetWaterY);
      svgPotWaterLine.setAttribute('y2', targetWaterY);
    }
    updateWaterHudBadge(targetWaterY, riceY, data.totalWaterMl);
    updatePotGaugeLines(targetWaterY);

    // Immediately vanish cup layer (no lingering cups)
    layer.style.opacity = '0';
    setTimeout(() => {
      if (activePourSequenceId === seqId && !isPouring) {
        dynGroup.innerHTML = '';
      }
    }, 200);
  }

  /**
   * Evaluates a cubic Bezier curve and its derivative at parameter t in [0, 1]
   */
  function evalCubicBezier(p0, p1, p2, p3, t) {
    const omt = 1 - t;
    const omt2 = omt * omt;
    const omt3 = omt2 * omt;
    const t2 = t * t;
    const t3 = t2 * t;

    const x = omt3 * p0.x + 3 * omt2 * t * p1.x + 3 * omt * t2 * p2.x + t3 * p3.x;
    const y = omt3 * p0.y + 3 * omt2 * t * p1.y + 3 * omt * t2 * p2.y + t3 * p3.y;

    const dx = 3 * omt2 * (p1.x - p0.x) + 6 * omt * t * (p2.x - p1.x) + 3 * t2 * (p3.x - p2.x);
    const dy = 3 * omt2 * (p1.y - p0.y) + 6 * omt * t * (p2.y - p1.y) + 3 * t2 * (p3.y - p2.y);

    return { x, y, dx, dy };
  }

  /**
   * Renders and animates N simultaneous cups with realistic parabolic streams and real cascading drops
   */
  function animateSimultaneousStage(cupCount, isPartial, remFraction, volumeToPour, initialPotMl, durationMs, onComplete) {
    if (seqId !== activePourSequenceId) return;

    // Build bouquet layout: cup size is realistically 38px wide by 50px tall
    const cupsMeta = [];
    if (cupCount === 1) {
      cupsMeta.push({
        u: 0,
        posX: 220 - 19, // center of cup at X = 220
        posY: 10,
        startAngle: -24,
        endAngle: -98
      });
    } else if (cupCount <= 8) {
      const spanRadius = Math.min(125, 26 + cupCount * 13);
      for (let i = 0; i < cupCount; i++) {
        const u = -1 + (2 * i) / (cupCount - 1); // from -1 (left) to +1 (right)
        const posX = 220 + u * spanRadius - 19;
        const posY = 8 + (u * u) * 15; // arched bouquet
        
        let startAngle, endAngle;
        if (u < -0.05) {
          startAngle = 24 + Math.abs(u) * 16;
          endAngle = 86 + Math.abs(u) * 16;
        } else if (u > 0.05) {
          startAngle = -(24 + Math.abs(u) * 16);
          endAngle = -(86 + Math.abs(u) * 16);
        } else {
          startAngle = -18;
          endAngle = -86;
        }
        cupsMeta.push({ u, posX, posY, startAngle, endAngle });
      }
    } else {
      // 13 cups: 2-tier arched bouquet to avoid crowded overlap
      const backCount = 7;
      const frontCount = 6;
      const backSpan = 130;
      const frontSpan = 110;

      for (let i = 0; i < backCount; i++) {
        const u = -1 + (2 * i) / (backCount - 1);
        const posX = 220 + u * backSpan - 19;
        const posY = 4 + (u * u) * 13;
        const startAngle = u < 0 ? (24 + Math.abs(u) * 15) : -(24 + Math.abs(u) * 15);
        const endAngle = u < 0 ? (88 + Math.abs(u) * 14) : -(88 + Math.abs(u) * 14);
        cupsMeta.push({ u, posX, posY, startAngle, endAngle, tier: 'back' });
      }
      for (let i = 0; i < frontCount; i++) {
        const u = -1 + (2 * i) / (frontCount - 1);
        const posX = 220 + u * frontSpan - 19;
        const posY = 18 + (u * u) * 13;
        const startAngle = u < 0 ? (26 + Math.abs(u) * 15) : -(26 + Math.abs(u) * 15);
        const endAngle = u < 0 ? (86 + Math.abs(u) * 14) : -(86 + Math.abs(u) * 14);
        cupsMeta.push({ u, posX, posY, startAngle, endAngle, tier: 'front' });
      }
    }

    // Determine initial cup water fill (total height = 42px)
    let startCupH = 42;
    let startCupY = 5;
    if (isPartial) {
      startCupH = Math.max(6, Math.round(remFraction * 42));
      startCupY = 47 - startCupH;
    }

    // Generate SVG markup for:
    // 1. Smooth curving fluid streams & shimmer lines
    // 2. Real cascading liquid droplets along the natural parabolic curve (NO sticks!)
    // 3. Detailed, scaled-up glass measuring cups (NO artificial marked puddle)
    let svgHtml = '<g class="dyn-stage-wrap">';

    // 1. Curved Fluid Streams and Cascading Droplets
    cupsMeta.forEach((meta, idx) => {
      svgHtml += `
        <g id="dynStreamGroup_${idx}" opacity="0">
          <!-- Translucent parabolic fluid ribbon with natural waterfall curve -->
          <path id="dynStreamFluid_${idx}" fill="url(#waterStreamGrad)" opacity="0.88"/>
          <!-- Shiny reflection highlight along center of curved stream -->
          <path id="dynStreamShimmer_${idx}" stroke="#ffffff" stroke-width="1.2" stroke-linecap="round" fill="none" opacity="0.7"/>
          
          <!-- Real Cascading Liquid Droplets (Organic teardrops following the curved path) -->
          <g id="dynDropletsGroup_${idx}">
            ${[0, 1, 2, 3, 4].map(dropIdx => `
              <g id="dynDrop_${idx}_${dropIdx}">
                <ellipse rx="2.2" ry="4.2" fill="url(#dropletGlowGrad)"/>
                <circle cx="-0.6" cy="-1.4" r="0.8" fill="#ffffff" opacity="0.95"/>
              </g>
            `).join('')}
          </g>
        </g>
      `;
    });

    // 2. Proportional, Scaled-Up Measuring Cups (38px x 50px)
    cupsMeta.forEach((meta, idx) => {
      const clipId = `dynClip_${seqId}_${idx}`;
      svgHtml += `
        <g id="dynCupGroup_${idx}" transform="translate(${meta.posX}, ${meta.posY}) rotate(${meta.startAngle} 19 25)">
          <defs>
            <clipPath id="${clipId}">
              <path d="M 3 3 L 7 47 C 7 49, 31 49, 31 47 L 35 3 Z"/>
            </clipPath>
          </defs>
          
          <!-- Liquid inside cup with smooth surface meniscus line -->
          <g clip-path="url(#${clipId})">
            <rect id="dynWater_${idx}" x="2" y="${startCupY}" width="34" height="${startCupH}" fill="url(#cupWaterGrad)"/>
            <line id="dynWaterLine_${idx}" x1="3" y1="${startCupY}" x2="35" y2="${startCupY}" stroke="#ffffff" stroke-width="1.5"/>
          </g>

          <!-- Glass Measuring Cup Body with Frosted Rim -->
          <path d="M 2 3 L 7 47 C 7 50, 31 50, 31 47 L 36 3 Z" 
                fill="rgba(255, 255, 255, 0.08)" stroke="rgba(255, 255, 255, 0.85)" stroke-width="1.4"/>
          <!-- Top Lip Rim -->
          <ellipse cx="19" cy="3" rx="17" ry="3.5" fill="none" stroke="rgba(255, 255, 255, 0.9)" stroke-width="1.3"/>
          <path d="M 7 47 C 7 50, 31 50, 31 47" fill="none" stroke="rgba(255, 255, 255, 0.6)" stroke-width="1.2"/>

          <!-- Embossed Measuring Scale Lines (160ml standard Japanese cup) -->
          <!-- Left side (Milliliters: 120, 80, 40) -->
          <line x1="3" y1="14" x2="9" y2="14" stroke="rgba(255, 255, 255, 0.85)" stroke-width="1.2"/>
          <line x1="4.5" y1="25" x2="10.5" y2="25" stroke="rgba(255, 255, 255, 0.75)" stroke-width="1.2"/>
          <line x1="6" y1="36" x2="12" y2="36" stroke="rgba(255, 255, 255, 0.75)" stroke-width="1.2"/>

          <!-- Right side (Fractions: 3/4, 1/2, 1/4) -->
          <line x1="29" y1="14" x2="35" y2="14" stroke="rgba(255, 255, 255, 0.85)" stroke-width="1.2"/>
          <line x1="27.5" y1="25" x2="33.5" y2="25" stroke="rgba(255, 255, 255, 0.75)" stroke-width="1.2"/>
          <line x1="26" y1="36" x2="32" y2="36" stroke="rgba(255, 255, 255, 0.75)" stroke-width="1.2"/>

          <!-- Glass Specular Reflection Streak -->
          <path d="M 6 5 L 9 44" stroke="rgba(255, 255, 255, 0.45)" stroke-width="1.2" stroke-linecap="round"/>
        </g>
      `;
    });

    svgHtml += '</g>';
    dynGroup.innerHTML = svgHtml;

    // Cache DOM references for silky 60fps performance
    const stageItems = cupsMeta.map((meta, idx) => ({
      u: meta.u,
      posX: meta.posX,
      posY: meta.posY,
      startAngle: meta.startAngle,
      endAngle: meta.endAngle,
      cupGroup: document.getElementById(`dynCupGroup_${idx}`),
      streamGroup: document.getElementById(`dynStreamGroup_${idx}`),
      streamFluid: document.getElementById(`dynStreamFluid_${idx}`),
      streamShimmer: document.getElementById(`dynStreamShimmer_${idx}`),
      waterRect: document.getElementById(`dynWater_${idx}`),
      waterLine: document.getElementById(`dynWaterLine_${idx}`),
      drops: [0, 1, 2, 3, 4].map(dIdx => document.getElementById(`dynDrop_${idx}_${dIdx}`))
    }));

    // Pause briefly so upright filled cups are seen, then tilt and pour
    setTimeout(() => {
      if (seqId !== activePourSequenceId) return;

      // Streams turn on
      stageItems.forEach(item => {
        if (item.streamGroup) item.streamGroup.style.opacity = '1';
      });

      const animStart = performance.now();

      function frame(currentTime) {
        if (seqId !== activePourSequenceId) return;

        const elapsed = currentTime - animStart;
        const progress = Math.min(1, elapsed / durationMs);

        // 1. Liquid inside each cup smoothly drains to 0%
        const currentDrainH = Math.max(0, startCupH * (1 - progress));
        const currentDrainY = 47 - currentDrainH;

        // 2. Pot water level rises smoothly
        const currentWaterMl = initialPotMl + progress * volumeToPour;
        const currentPotWaterY = riceY - (currentWaterMl / data.totalWaterMl) * totalWaterRise;
        const currentPotWaterH = Math.max(0, riceY - currentPotWaterY);

        if (svgPotWaterRect) {
          svgPotWaterRect.setAttribute('y', currentPotWaterY);
          svgPotWaterRect.setAttribute('height', currentPotWaterH);
        }
        if (svgPotWaterLine) {
          svgPotWaterLine.setAttribute('y1', currentPotWaterY);
          svgPotWaterLine.setAttribute('y2', currentPotWaterY);
        }
        updateWaterHudBadge(currentPotWaterY, riceY, currentWaterMl);
        updatePotGaugeLines(currentPotWaterY);

        // 3. Update each cup's dynamic tilt angle, fluid stream, and real cascading droplets
        stageItems.forEach(item => {
          // Angle slowly dips deeper down past horizontal as water empties (e.g. 24° -> 100°)
          const curAngle = item.startAngle + progress * (item.endAngle - item.startAngle);
          const rad = curAngle * Math.PI / 180;
          const cosT = Math.cos(rad);
          const sinT = Math.sin(rad);

          if (item.cupGroup) {
            item.cupGroup.setAttribute('transform', `translate(${item.posX}, ${item.posY}) rotate(${curAngle.toFixed(1)} 19 25)`);
          }
          if (item.waterRect) {
            item.waterRect.setAttribute('y', currentDrainY);
            item.waterRect.setAttribute('height', currentDrainH);
          }
          if (item.waterLine) {
            item.waterLine.setAttribute('y1', currentDrainY);
            item.waterLine.setAttribute('y2', currentDrainY);
          }

          // Exact mouth lip coordinates dynamically computed from curAngle (center at 19, 25)
          const cx = item.posX + 19;
          const cy = item.posY + 25;
          let lipLowX, lipLowY, lipHighX, lipHighY;

          if (curAngle >= 0) {
            // Tilted clockwise: right lip (+17, -22) is lower
            lipLowX = cx + 17 * cosT + 22 * sinT;
            lipLowY = cy + 17 * sinT - 22 * cosT;
            lipHighX = cx - 17 * cosT + 22 * sinT;
            lipHighY = cy - 17 * sinT - 22 * cosT;
          } else {
            // Tilted counter-clockwise: left lip (-17, -22) is lower
            lipLowX = cx - 17 * cosT + 22 * sinT;
            lipLowY = cy - 17 * sinT - 22 * cosT;
            lipHighX = cx + 17 * cosT + 22 * sinT;
            lipHighY = cy + 17 * sinT - 22 * cosT;
          }

          // Water stream origins across the pouring mouth (width = 5px)
          const s1X = lipLowX;
          const s1Y = lipLowY;
          const s2X = lipLowX + 0.22 * (lipHighX - lipLowX);
          const s2Y = lipLowY + 0.22 * (lipHighY - lipLowY);
          const sMidX = (s1X + s2X) / 2;
          const sMidY = (s1Y + s2Y) / 2;

          // Impact point at pot water surface
          const impactX = 220 + item.u * 4.0;
          const dY = Math.max(16, currentPotWaterY - sMidY);

          // Pronounced Parabolic Waterfall Arc (Water shoots out towards center, then curves down!)
          const dxLeft = (impactX - 1.5) - s1X;
          const cp1X_left = s1X + dxLeft * 0.64;
          const cp1Y_left = s1Y + dY * 0.14;
          const cp2X_left = (impactX - 1.5) - dxLeft * 0.08;
          const cp2Y_left = currentPotWaterY - dY * 0.32;

          const dxRight = (impactX + 1.5) - s2X;
          const cp1X_right = s2X + dxRight * 0.64;
          const cp1Y_right = s2Y + dY * 0.14;
          const cp2X_right = (impactX + 1.5) - dxRight * 0.08;
          const cp2Y_right = currentPotWaterY - dY * 0.32;

          const cp1X_mid = (cp1X_left + cp1X_right) / 2;
          const cp1Y_mid = (cp1Y_left + cp1Y_right) / 2;
          const cp2X_mid = (cp2X_left + cp2X_right) / 2;
          const cp2Y_mid = (cp2Y_left + cp2Y_right) / 2;

          // Update fluid ribbon with parabolic waterfall curve
          if (item.streamFluid) {
            item.streamFluid.setAttribute('d',
              `M ${s1X.toFixed(1)} ${s1Y.toFixed(1)} ` +
              `C ${cp1X_left.toFixed(1)} ${cp1Y_left.toFixed(1)}, ${cp2X_left.toFixed(1)} ${cp2Y_left.toFixed(1)}, ${(impactX - 1.5).toFixed(1)} ${currentPotWaterY.toFixed(1)} ` +
              `L ${(impactX + 1.5).toFixed(1)} ${currentPotWaterY.toFixed(1)} ` +
              `C ${cp2X_right.toFixed(1)} ${cp2Y_right.toFixed(1)}, ${cp1X_right.toFixed(1)} ${cp1Y_right.toFixed(1)}, ${s2X.toFixed(1)} ${s2Y.toFixed(1)} Z`
            );
          }

          // Update shimmer line
          if (item.streamShimmer) {
            item.streamShimmer.setAttribute('d',
              `M ${sMidX.toFixed(1)} ${sMidY.toFixed(1)} ` +
              `C ${cp1X_mid.toFixed(1)} ${cp1Y_mid.toFixed(1)}, ${cp2X_mid.toFixed(1)} ${cp2Y_mid.toFixed(1)}, ${impactX.toFixed(1)} ${currentPotWaterY.toFixed(1)}`
            );
          }

          // Update Real Cascading Water Droplets (Organic beads accelerating under gravity along the curve!)
          const p0 = { x: sMidX, y: sMidY };
          const p1 = { x: cp1X_mid, y: cp1Y_mid };
          const p2 = { x: cp2X_mid, y: cp2Y_mid };
          const p3 = { x: impactX, y: currentPotWaterY };

          item.drops.forEach((dropEl, dIdx) => {
            if (!dropEl) return;
            const phase = (currentTime * 0.0018 + dIdx * 0.20) % 1;
            // Gravity acceleration mapping
            const tParam = Math.pow(phase, 1.25);
            const pt = evalCubicBezier(p0, p1, p2, p3, tParam);
            const angleDeg = Math.atan2(pt.dy, pt.dx) * 180 / Math.PI - 90;

            dropEl.setAttribute('transform', `translate(${pt.x.toFixed(1)}, ${pt.y.toFixed(1)}) rotate(${angleDeg.toFixed(1)})`);
          });
        });

        if (progress < 1) {
          requestAnimationFrame(frame);
        } else {
          // Stage completed: hide streams immediately
          stageItems.forEach(item => {
            if (item.streamGroup) item.streamGroup.style.opacity = '0';
          });
          onComplete();
        }
      }

      requestAnimationFrame(frame);
    }, 120);
  }

  // PHASE 1: Show all N full cups at a time in bouquet formation (e.g. 6 cups at once!)
  if (hasFull) {
    const fullDuration = 1500;
    animateSimultaneousStage(data.fullCups, false, 1.0, fullVolume, 0, fullDuration, () => {
      // PHASE 2: If there's any remaining partial cup, pour it later
      if (hasRem) {
        setTimeout(() => {
          if (seqId !== activePourSequenceId) return;

          const remFraction = data.remMl / CUP_CAPACITY_ML;
          const remDuration = 1000;

          animateSimultaneousStage(1, true, remFraction, data.remMl, fullVolume, remDuration, () => {
            finishEverything();
          });
        }, 220);
      } else {
        finishEverything();
      }
    });
  } else if (hasRem) {
    // Only a fractional cup (< 1 full cup)
    const remFraction = data.remMl / CUP_CAPACITY_ML;
    animateSimultaneousStage(1, true, remFraction, data.remMl, 0, 1100, () => {
      finishEverything();
    });
  } else {
    finishEverything();
  }
}

/**
 * Updates UI controls, HUD callouts, and table selection
 */
function updateUI(options = {}) {
  const data = calculateWater(selectedRiceCups);

  // 1. Update Rice Controls
  const displayRiceCups = document.getElementById('displayRiceCups');
  if (displayRiceCups) {
    displayRiceCups.textContent = data.riceCups.toFixed(data.riceCups % 1 === 0 ? 1 : 2);
  }
  const displayRiceMl = document.getElementById('displayRiceMl');
  if (displayRiceMl) {
    displayRiceMl.textContent = `(${data.riceMl} ml)`;
  }
  const riceSlider = document.getElementById('riceSlider');
  if (riceSlider) {
    riceSlider.value = data.riceCups;
  }

  // Update quick pills
  document.querySelectorAll('.pill-btn').forEach(btn => {
    const val = parseFloat(btn.dataset.cups);
    if (Math.abs(val - data.riceCups) < 0.01) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // 2. Update Pot Visual (Water & Rice Layers + HUD Callouts)
  updatePotVisual(data);

  // 3. Update Unified Pouring Formula (Side panel)
  updateCupsGrid(data);

  // 4. Update Table Selection
  updateTableSelection(data.riceCups);

  // 5. Trigger Multi-Cup Pour Animation if requested
  if (options.animatePour) {
    runSimultaneousMultiCupPour(data);
  }
}

/**
 * Updates rice & water levels inside the pot visual (when not animating)
 */
function updatePotVisual(data) {
  const svgPotRiceRect = document.getElementById('svgPotRiceRect');
  const svgPotRicePattern = document.getElementById('svgPotRicePattern');
  const svgPotRiceLine = document.getElementById('svgPotRiceLine');
  const svgPotWaterRect = document.getElementById('svgPotWaterRect');
  const svgPotWaterLine = document.getElementById('svgPotWaterLine');
  const svgHudWater = document.getElementById('svgHudWater');
  const svgHudWaterText = document.getElementById('svgHudWaterText');
  const svgHudRice = document.getElementById('svgHudRice');
  const svgHudRiceText = document.getElementById('svgHudRiceText');

  // Exact Real-World Pot Calibration (viewBox 0 0 440 370):
  // Inner Base at Y = 315. Stamped lines: Line 2=273, Line 4=231, Line 6=189, Line 8=147, Line 10=105 (21px per line).
  // Real measurement: 2.0c rice + 6.5c water reaches Line 4 (1.625 cups of water per line).
  // For 2.0c rice with 5.5c water: level reaches Line 3.4 (decreased below Line 4 to Y = 244!).
  const potLineNum = data.totalWaterCups / CUPS_PER_LINE;
  const waterY = Math.max(70, 315 - (potLineNum * 21));

  // 1. Rice bed firmly on bottom (Straight horizontal line):
  const riceHeight = Math.min(65, Math.max(12, data.riceCups * 13));
  const riceY = 315 - riceHeight;
  const waterDepth = Math.max(4, riceY - waterY);

  if (svgPotRiceRect) {
    svgPotRiceRect.setAttribute('y', riceY);
    svgPotRiceRect.setAttribute('height', riceHeight + 30);
  }
  if (svgPotRicePattern) {
    svgPotRicePattern.setAttribute('y', riceY);
    svgPotRicePattern.setAttribute('height', riceHeight + 30);
  }
  if (svgPotRiceLine) {
    svgPotRiceLine.setAttribute('y1', riceY);
    svgPotRiceLine.setAttribute('y2', riceY);
  }

  // 2. Water layer sits cleanly ABOVE the rice (when idle)
  if (!isPouring) {
    if (svgPotWaterRect) {
      svgPotWaterRect.setAttribute('y', waterY);
      svgPotWaterRect.setAttribute('height', waterDepth);
    }
    if (svgPotWaterLine) {
      svgPotWaterLine.setAttribute('y1', waterY);
      svgPotWaterLine.setAttribute('y2', waterY);
    }
    updateWaterHudBadge(waterY, riceY, data.totalWaterMl);
    updatePotGaugeLines(waterY);
  }

  // 3. Rice HUD Callout (Always visible)
  if (svgHudRice) {
    svgHudRice.setAttribute('transform', `translate(0, ${riceY})`);
  }
  if (svgHudRiceText) {
    svgHudRiceText.textContent = `🍚 Rice: ${data.riceCups} Cup${data.riceCups > 1 ? 's' : ''} (${data.riceMl} ml)`;
  }
}

/**
 * Unified mini measuring cup SVG generator (Identical pot design for all formula badges)
 */
function renderMiniCupSvg(fractionPercent) {
  const pct = Math.max(0, Math.min(100, fractionPercent));
  const waterY = 38 - (pct / 100) * 30;
  const waterHeight = 38 - waterY;
  const clipId = `miniCupClip_${Math.round(pct)}_${Math.floor(Math.random() * 1000)}`;

  return `
    <svg class="formula-mini-svg" viewBox="0 0 32 44" width="28" height="38" aria-hidden="true">
      <defs>
        <clipPath id="${clipId}">
          <path d="M 6 4 L 9 38 C 9 40, 23 40, 23 38 L 26 4 Z"/>
        </clipPath>
      </defs>
      <!-- Glass Beaker Silhouette (Matches main 160ml cup) -->
      <path d="M 6 4 L 9 38 C 9 40, 23 40, 23 38 L 26 4 Z" 
            fill="rgba(255, 255, 255, 0.08)" stroke="rgba(255, 255, 255, 0.55)" stroke-width="1.2"/>
      <!-- Water Fill (Strict horizontal straight surface line) -->
      <g clip-path="url(#${clipId})">
        <rect x="5" y="${waterY}" width="22" height="${waterHeight + 2}" fill="#38bdf8"/>
        <line x1="6" y1="${waterY}" x2="26" y2="${waterY}" stroke="#ffffff" stroke-width="1.5"/>
      </g>
      <!-- Top Rim -->
      <ellipse cx="16" cy="4" rx="10" ry="2" fill="none" stroke="rgba(255, 255, 255, 0.75)" stroke-width="1.2"/>
      <!-- Scale Ticks (Left & Right) -->
      <line x1="7" y1="8" x2="10" y2="8" stroke="rgba(255,255,255,0.7)" stroke-width="1"/>
      <line x1="22" y1="8" x2="25" y2="8" stroke="rgba(255,255,255,0.7)" stroke-width="1"/>
      <line x1="8" y1="18" x2="11" y2="18" stroke="rgba(255,255,255,0.5)" stroke-width="1"/>
      <line x1="21" y1="18" x2="24" y2="18" stroke="rgba(255,255,255,0.5)" stroke-width="1"/>
      <line x1="8" y1="28" x2="11" y2="28" stroke="rgba(255,255,255,0.5)" stroke-width="1"/>
      <line x1="21" y1="28" x2="24" y2="28" stroke="rgba(255,255,255,0.5)" stroke-width="1"/>
    </svg>
  `;
}

/**
 * Updates the unified Pouring Formula badges on the side panel
 */
function updateCupsGrid(data) {
  const container = document.getElementById('cupsGrid');
  if (!container) return;
  container.innerHTML = '';

  // 1. Full Cups Badge
  if (data.fullCups > 0) {
    const fullBadge = document.createElement('div');
    fullBadge.className = 'formula-badge-card';
    fullBadge.innerHTML = `
      <span class="formula-mult">${data.fullCups}×</span>
      ${renderMiniCupSvg(100)}
      <div class="formula-text-block">
        <span class="formula-main-name">${data.fullCups > 1 ? 'Full Cups' : 'Full Cup'}</span>
        <span class="formula-sub-name">160 ml each</span>
      </div>
    `;
    container.appendChild(fullBadge);
  }

  // 2. Plus Sign & Remaining Cup Badge
  if (data.remMl > 0) {
    if (data.fullCups > 0) {
      const plus = document.createElement('span');
      plus.className = 'formula-plus-sign';
      plus.textContent = '+';
      container.appendChild(plus);
    }

    const fractionPercent = Math.min(100, Math.round((data.remMl / 160) * 100));
    let markSub = `${data.remMl} ml`;
    if (data.remMl === 80) markSub = '80 ml (½ line)';
    else if (data.remMl === 120) markSub = '120 ml (¾ line)';
    else if (data.remMl === 40) markSub = '40 ml (¼ line)';

    const remBadge = document.createElement('div');
    remBadge.className = 'formula-badge-card';
    remBadge.innerHTML = `
      <span class="formula-mult">1×</span>
      ${renderMiniCupSvg(fractionPercent)}
      <div class="formula-text-block">
        <span class="formula-main-name">Partial Cup</span>
        <span class="formula-sub-name">${markSub}</span>
      </div>
    `;
    container.appendChild(remBadge);
  }
}

/**
 * Builds the Quick Reference Table
 */
function buildCheatsheetTable() {
  const tbody = document.getElementById('cheatsheetBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  CHEATSHEET_DATA.forEach(cups => {
    const data = calculateWater(cups);
    const tr = document.createElement('tr');
    tr.dataset.cups = cups;

    if (cups === 2.0) {
      tr.className = 'benchmark-row';
    }

    tr.innerHTML = `
      <td><strong>${cups} ${cups === 1 ? 'Cup' : 'Cups'}</strong> ${cups === 2.0 ? '<span class="star-tag">⭐ Your Recipe</span>' : ''}</td>
      <td>${data.riceMl} ml</td>
      <td><strong>${data.totalWaterMl} ml</strong> (${data.totalWaterCups} cups)</td>
      <td><span class="measure-pill">${data.summary}</span></td>
      <td><strong>Line ${data.potGaugeLine}</strong></td>
    `;

    tr.addEventListener('click', () => {
      selectedRiceCups = cups;
      updateUI({ animatePour: true });
    });

    tbody.appendChild(tr);
  });
}

function updateTableSelection(currentCups) {
  document.querySelectorAll('#cheatsheetBody tr').forEach(tr => {
    const cups = parseFloat(tr.dataset.cups);
    if (Math.abs(cups - currentCups) < 0.01) {
      tr.classList.add('selected-row');
    } else {
      tr.classList.remove('selected-row');
    }
  });
}

// Event Listeners Initialization
document.addEventListener('DOMContentLoaded', () => {
  // Quick buttons (0.5 to 5.0 Cups)
  document.querySelectorAll('.pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedRiceCups = parseFloat(btn.dataset.cups);
      updateUI({ animatePour: true });
    });
  });

  // Stepper Minus & Plus
  const btnMinus = document.getElementById('btnMinus');
  const btnPlus = document.getElementById('btnPlus');
  const slider = document.getElementById('riceSlider');

  if (btnMinus) {
    btnMinus.addEventListener('click', () => {
      selectedRiceCups = Math.max(0.25, Math.round((selectedRiceCups - 0.25) * 4) / 4);
      updateUI({ animatePour: true });
    });
  }

  if (btnPlus) {
    btnPlus.addEventListener('click', () => {
      selectedRiceCups = Math.min(6.0, Math.round((selectedRiceCups + 0.25) * 4) / 4);
      updateUI({ animatePour: true });
    });
  }

  if (slider) {
    // Real-time update while dragging
    slider.addEventListener('input', (e) => {
      selectedRiceCups = parseFloat(e.target.value);
      updateUI({ animatePour: false });
    });

    // Run sequential pour animation on slider release
    slider.addEventListener('change', () => {
      updateUI({ animatePour: true });
    });
  }

  // Build table and initial UI render (idle state: cup hidden, calibrated pot displayed)
  buildCheatsheetTable();
  updateUI({ animatePour: false });
});
