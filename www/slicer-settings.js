// Réglages CuraEngine pour Creality Ender 3 (buse 0,4, filament 1,75).
//
// CuraEngine en ligne de commande N'ÉVALUE PAS les formules (« value ») des
// définitions Cura : il ne lit que les « default_value » de fdmprinter. Tous les
// réglages dérivés que Cura calcule normalement (écart des lignes de remplissage,
// nombre de parois, couches dessus/dessous, vitesses du profil Creality…) doivent
// donc être calculés ici et passés explicitement. Vérifié : passer seulement
// infill_sparse_density ne change RIEN au G-code.
//
// Chaque réglage est passé deux fois : global (-s) puis extrudeur 0 (-e0 -s),
// car les réglages « maille » (remplissage, parois, supports) héritent de
// l'extrudeur — un -s global seul n'y arrive pas.

export const MATERIALS = {
  PLA:  { nozzle: 200, bed: 60, fan: 100, density: 1.24, retract: 5,   label: 'PLA' },
  PETG: { nozzle: 235, bed: 80, fan: 50,  density: 1.27, retract: 6,   label: 'PETG' },
  TPU:  { nozzle: 225, bed: 50, fan: 100, density: 1.21, retract: 2,   label: 'TPU (souple)', slow: true },
  ABS:  { nozzle: 240, bed: 100, fan: 0,  density: 1.04, retract: 5,   label: 'ABS' },
};

export const QUALITIES = {
  fine:     { lh: 0.12, label: 'Fine 0,12 mm' },
  standard: { lh: 0.20, label: 'Standard 0,20 mm' },
  draft:    { lh: 0.28, label: 'Rapide 0,28 mm' },
};

export const DEFAULT_OPTS = {
  quality: 'standard', material: 'PLA', infill: 15, walls: 2,
  support: 'none', adhesion: 'skirt', bed: 220,
};

const LW = 0.4;

function infillLineDistance(density, pattern) {
  if (!density) return 0;
  // Formule de fdmprinter.def.json (infill_line_distance).
  const f = pattern === 'grid' ? 2
    : ['triangles', 'trihexagon', 'cubic', 'cubicsubdiv'].includes(pattern) ? 3
    : ['tetrahedral', 'quarter_cubic'].includes(pattern) ? 2
    : 1;
  return +(LW * 100 / density * f).toFixed(3);
}

export function curaSettings(o) {
  o = { ...DEFAULT_OPTS, ...o };
  const m = MATERIALS[o.material] || MATERIALS.PLA;
  const lh = (QUALITIES[o.quality] || QUALITIES.standard).lh;
  const lh0 = Math.max(0.2, lh);
  const density = Math.max(0, Math.min(100, +o.infill || 0));
  const pattern = density > 50 ? 'lines' : (density >= 100 ? 'lines' : 'cubic');
  const sp = m.slow ? 25 : 50;                       // vitesse d'impression
  const solid = 0.8;                                 // épaisseur dessus/dessous visée
  const topLayers = Math.max(4, Math.ceil(solid / lh));
  const botLayers = Math.max(3, Math.ceil((solid - lh0) / lh) + 1);
  const support = o.support !== 'none';

  const s = {
    // machine
    machine_width: o.bed, machine_depth: o.bed, machine_height: 250,
    machine_center_is_zero: false, machine_heated_bed: true,
    // couches
    layer_height: lh, layer_height_0: lh0,
    line_width: LW, wall_line_width: LW, wall_line_width_0: LW, wall_line_width_x: LW,
    skin_line_width: LW, infill_line_width: LW, skirt_brim_line_width: LW,
    support_line_width: LW, support_interface_line_width: LW,
    initial_layer_line_width_factor: 100,
    // parois / dessus / dessous
    wall_line_count: Math.max(1, Math.min(6, +o.walls || 2)),
    wall_thickness: LW * (+o.walls || 2),
    top_layers: topLayers, bottom_layers: botLayers,
    top_thickness: +(topLayers * lh).toFixed(3), bottom_thickness: +(botLayers * lh).toFixed(3),
    top_bottom_pattern: 'lines', top_bottom_pattern_0: 'lines',
    z_seam_type: 'sharpest_corner', optimize_wall_printing_order: true,
    outer_inset_first: false, fill_outline_gaps: true,
    // remplissage
    infill_sparse_density: density, infill_pattern: pattern,
    infill_line_distance: infillLineDistance(density, pattern),
    infill_overlap: 30, infill_sparse_thickness: lh,
    // matériau
    material_print_temperature: m.nozzle, material_print_temperature_layer_0: m.nozzle + 5,
    material_initial_print_temperature: m.nozzle, material_final_print_temperature: m.nozzle,
    material_bed_temperature: m.bed, material_bed_temperature_layer_0: m.bed,
    material_diameter: 1.75, material_flow: 100,
    // vitesses (profil Creality : murs et dessus/dessous à moitié)
    speed_print: sp, speed_infill: sp, speed_wall: sp / 2, speed_wall_0: sp / 2,
    speed_wall_x: sp / 2, speed_topbottom: sp / 2, speed_support: sp,
    speed_support_infill: sp, speed_layer_0: 20, speed_print_layer_0: 20,
    speed_travel_layer_0: 100, skirt_brim_speed: 20, speed_travel: m.slow ? 100 : 150,
    acceleration_enable: false, jerk_enable: false,
    // rétraction
    retraction_enable: true, retraction_amount: m.retract, retraction_speed: m.slow ? 25 : 45,
    retraction_retract_speed: m.slow ? 25 : 45, retraction_prime_speed: m.slow ? 25 : 45,
    retraction_min_travel: 1.5, retraction_hop_enable: false,
    retraction_combing: 'noskin', retraction_combing_max_distance: 30,
    travel_avoid_other_parts: true, travel_avoid_distance: 0.625,
    // refroidissement
    cool_fan_enabled: m.fan > 0, cool_fan_speed: m.fan, cool_fan_speed_min: m.fan,
    cool_fan_speed_max: m.fan, cool_fan_full_at_height: lh0 + 2 * lh, cool_fan_full_layer: 3,
    cool_min_layer_time: 10, cool_min_speed: 10,
    // supports
    support_enable: support, support_type: o.support === 'everywhere' ? 'everywhere' : 'buildplate',
    support_angle: 50, support_pattern: 'zigzag', support_infill_rate: 15,
    support_line_distance: +(LW * 100 / 15).toFixed(3), support_initial_layer_line_distance: +(LW * 100 / 15).toFixed(3),
    support_z_distance: lh, support_top_distance: lh, support_bottom_distance: lh,
    support_xy_distance: 0.7, support_wall_count: 0, support_interface_enable: false,
    support_use_towers: false, support_brim_enable: false,
    // adhérence
    adhesion_type: o.adhesion, skirt_line_count: 3, skirt_gap: 5,
    brim_width: 8, brim_line_count: Math.ceil(8 / LW), brim_outside_only: true,
    // divers
    magic_spiralize: false, meshfix_union_all: true, meshfix_union_all_remove_holes: false,
    relative_extrusion: false,
  };
  // ORDRE IMPORTANT : dans la ligne de commande CuraEngine, « -e0 » reste actif
  // pour tous les « -s » qui suivent. Tous les globaux d'abord, puis l'extrudeur.
  const ent = Object.entries(s);
  const ov = [
    ...ent.map(([k, v]) => ({ key: k, value: v })),
    ...ent.map(([k, v]) => ({ scope: 'e0', key: k, value: v })),
  ];
  return { overrides: ov, material: m, layerHeight: lh };
}

// Masse de filament (g) à partir de la longueur (mm) de filament 1,75.
export function filamentGrams(mm, material) {
  const m = MATERIALS[material] || MATERIALS.PLA;
  const area = Math.PI * (1.75 / 2) ** 2;            // mm²
  return mm * area / 1000 * m.density;
}
