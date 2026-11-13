/* Dispatch Academy: core logic (pure, no DOM). Works in browser (window.Engine) and Node (require). */
(function (root, factory) {
  var bank = (typeof module === 'object' && module.exports) ? require('./bank.js') : root.Bank;
  var api = factory(bank);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof self !== 'undefined' ? self : this, function (Bank) {
  'use strict';

  // ---------- random helpers ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function ri(rng, a, b) { return a + Math.floor(rng() * (b - a + 1)); }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
  function shuffle(rng, arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  // ---------- fraction math ----------
  function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { var t = b; b = a % b; a = t; } return a || 1; }
  function lcm(a, b) { return Math.abs(a * b) / gcd(a, b); }
  function frac(n, d) {
    if (!d) throw new Error('Denominator cannot be 0');
    if (d < 0) { n = -n; d = -d; }
    return { n: n, d: d };
  }
  function simplify(f) { var g = gcd(f.n, f.d); return frac(f.n / g, f.d / g); }
  function addF(a, b) { var L = lcm(a.d, b.d); return frac(a.n * (L / a.d) + b.n * (L / b.d), L); }
  function subF(a, b) { var L = lcm(a.d, b.d); return frac(a.n * (L / a.d) - b.n * (L / b.d), L); }
  function compareF(a, b) { var x = a.n * b.d - b.n * a.d; return x > 0 ? 1 : x < 0 ? -1 : 0; }
  function equalsF(a, b) { return compareF(a, b) === 0; }
  function isSimplest(f) { return gcd(f.n, f.d) === 1; }
  function fstr(f) { return f.d === 1 ? String(f.n) : f.n + '/' + f.d; }

  function parseNumber(s) {
    if (s === null || s === undefined) return null;
    s = String(s).trim().replace(/,/g, '').replace(/\s+/g, '');
    if (!/^-?\d+$/.test(s)) return null;
    return parseInt(s, 10);
  }
  // Accepts "3/4", "1 1/2", "2", " 6 / 8 "
  function parseFraction(s) {
    if (s === null || s === undefined) return null;
    s = String(s).trim().replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ');
    var m;
    if ((m = /^(-?\d+)$/.exec(s))) return frac(parseInt(m[1], 10), 1);
    if ((m = /^(-?\d+)\/(\d+)$/.exec(s))) { if (+m[2] === 0) return null; return frac(parseInt(m[1], 10), parseInt(m[2], 10)); }
    if ((m = /^(\d+) (\d+)\/(\d+)$/.exec(s))) {
      var w = +m[1], n = +m[2], d = +m[3]; if (!d) return null; return frac(w * d + n, d);
    }
    return null;
  }

  var NAMES = { 2: 'halves', 3: 'thirds', 4: 'fourths', 5: 'fifths', 6: 'sixths', 8: 'eighths', 9: 'ninths', 10: 'tenths', 12: 'twelfths', 16: 'sixteenths', 15: 'fifteenths', 18: 'eighteenths', 20: 'twentieths', 24: 'twenty-fourths' };
  function be(n) { return n === 1 ? 'is' : 'are'; }
  function denName(d) { return NAMES[d] || (d + 'ths'); }

  // ---------- catalog ----------
  var THEMES = {
    fortnite: { label: 'Fortnite', emoji: '🪂' },
    roblox: { label: 'Roblox', emoji: '🧱' },
    karate: { label: 'Karate', emoji: '🥋' },
    soccer: { label: 'Soccer', emoji: '⚽' },
    baseball: { label: 'Baseball', emoji: '⚾' }
  };
  var THEME_KEYS = Object.keys(THEMES);

  // The 7 subjects. texas:true = one of the 5 subjects Texas requires for homeschooling.
  var SUBJECTS = [
    { id: 'math', label: 'Math', icon: '🧮', texas: true, dad: 'Math: multiplying, dividing, fractions, decimals, and geometry' },
    { id: 'reading', label: 'Reading', icon: '📖', texas: true, dad: 'Reading: understanding what he reads' },
    { id: 'spelling', label: 'Spelling', icon: '🔤', texas: true, dad: 'Spelling and word parts' },
    { id: 'grammar', label: 'Grammar', icon: '✏️', texas: true, dad: 'Grammar: writing correct sentences' },
    { id: 'citizenship', label: 'Good Citizenship', icon: '🇺🇸', texas: true, dad: 'Good citizenship: government, rules, sportsmanship, and online safety' },
    { id: 'science', label: 'Science', icon: '🔬', texas: false, dad: 'Science: matter, forces, Earth, and living things' },
    { id: 'social', label: 'Social Studies', icon: '🗺️', texas: false, dad: 'Social studies: U.S. history, maps, and Texas' }
  ];
  var SUBJECT_ORDER = SUBJECTS.map(function (s) { return s.id; });
  function subjectById(id) { for (var i = 0; i < SUBJECTS.length; i++) if (SUBJECTS[i].id === id) return SUBJECTS[i]; return null; }

  var SKILLS = {
    ops: { subject: 'math', label: 'Multiplication & Division', dad: 'Multiplying and dividing bigger numbers' },
    word: { subject: 'math', label: 'Multi-Step Word Problems', dad: 'Word problems that take more than one step' },
    fracIntro: { subject: 'math', label: 'Fraction Basics', dad: 'Knowing what a fraction means (parts of a whole)' },
    equiv: { subject: 'math', label: 'Equivalent & Comparing Fractions', dad: 'Spotting equal fractions and which fraction is bigger' },
    addsub: { subject: 'math', label: 'Adding & Subtracting Fractions', dad: 'Adding and subtracting fractions' },
    decimals: { subject: 'math', label: 'Decimals & Money', dad: 'Decimals, place value, and money' },
    geometry: { subject: 'math', label: 'Geometry & Order of Operations', dad: 'Perimeter, area, volume, and order of operations' },
    readComp: { subject: 'reading', label: 'Reading Comprehension', dad: 'Main idea, details, and cause and effect in a short story' },
    readClues: { subject: 'reading', label: 'Context Clues & Inference', dad: 'Figuring out new words and reading between the lines' },
    spelling: { subject: 'spelling', label: 'Commonly Misspelled Words', dad: 'Spelling tricky 5th grade words' },
    wordParts: { subject: 'spelling', label: 'Prefixes, Suffixes & Roots', dad: 'Word parts like re-, un-, -ful, and -less' },
    homophones: { subject: 'spelling', label: 'Homophones', dad: 'Sound-alike words like there, their, and they\'re' },
    speech: { subject: 'grammar', label: 'Parts of Speech', dad: 'Nouns, verbs, adjectives, and adverbs' },
    mechanics: { subject: 'grammar', label: 'Punctuation & Agreement', dad: 'Commas, apostrophes, quotation marks, and verb agreement' },
    sentences: { subject: 'grammar', label: 'Complete Sentences', dad: 'Fixing run-ons and fragments' },
    gov: { subject: 'citizenship', label: 'How Government Works', dad: 'The three branches, the Constitution, and Texas government' },
    citizen: { subject: 'citizenship', label: 'Everyday & Digital Citizenship', dad: 'Sportsmanship, community, and online safety' },
    matter: { subject: 'science', label: 'Matter & Its Properties', dad: 'Mass, sink or float, mixtures, and conductors' },
    force: { subject: 'science', label: 'Force, Motion & Energy', dad: 'Forces, circuits, and light' },
    earth: { subject: 'science', label: 'Earth, Space & Living Things', dad: 'Day and night, the water cycle, landforms, and food chains' },
    geo: { subject: 'social', label: 'Maps & U.S. Regions', dad: 'Reading maps and U.S. and Texas geography' },
    early: { subject: 'social', label: 'Colonies & Revolution', dad: 'Early America and the American Revolution' },
    nation: { subject: 'social', label: 'Constitution & Westward Expansion', dad: 'The Constitution, westward expansion, and timelines' }
  };
  var SKILL_ORDER = Object.keys(SKILLS);
  function skillsFor(subject) { return SKILL_ORDER.filter(function (k) { return SKILLS[k].subject === subject; }); }

  var MODULES = [
    { id: 'warmup', subject: 'math', num: 1, title: 'Warmup Ops', skill: 'ops', blurb: 'Multiply and divide with V-Bucks, Robux, and tournament brackets.', icon: '⚡' },
    { id: 'basics', subject: 'math', num: 2, title: 'Fraction Basics', skill: 'fracIntro', blurb: 'Parts of a whole, number lines, and a fraction bar you can click.', icon: '🧩' },
    { id: 'equiv', subject: 'math', num: 3, title: 'Equivalent & Simplifying', skill: 'equiv', blurb: 'Storm timers, loot splits, and soccer halves and quarters.', icon: '🔁' },
    { id: 'compare', subject: 'math', num: 4, title: 'Comparing Fractions', skill: 'equiv', blurb: 'Who has the better win rate, batting average, or kick accuracy?', icon: '⚖️' },
    { id: 'addsub', subject: 'math', num: 5, title: 'Add & Subtract Fractions', skill: 'addsub', blurb: 'Same bottoms first, then a helper for different bottoms.', icon: '➕' },
    { id: 'gameday', subject: 'math', num: 6, title: 'Game Day Word Problems', skill: 'word', blurb: 'Real game situations from Fortnite, Roblox, karate, soccer, and baseball.', icon: '🏆' },
    { id: 'decimals', subject: 'math', num: 7, title: 'Decimals & Money', skill: 'decimals', blurb: 'Compare decimals, place value, V-Bucks money, and batting averages.', icon: '💵' },
    { id: 'geometry', subject: 'math', num: 8, title: 'Geometry & Order of Operations', skill: 'geometry', blurb: 'Perimeter, area, and volume with soccer fields and Roblox blocks, plus order of operations.', icon: '📐' },
    { id: 'reading', subject: 'reading', num: 1, title: 'Story Missions', skill: 'readComp', blurb: 'Short reads about Fortnite, Roblox, karate, the World Cup, and baseball legends. Then 5 questions.', icon: '📖', bank: true },
    { id: 'clues', subject: 'reading', num: 2, title: 'Word Detective', skill: 'readClues', blurb: 'Use context clues to figure out new words and how people feel.', icon: '🕵️', bank: true },
    { id: 'spell', subject: 'spelling', num: 1, title: 'Spelling Showdown', skill: 'spelling', blurb: 'Pick the right spelling or type the fix for a misspelled word.', icon: '🔤', bank: true },
    { id: 'wordparts', subject: 'spelling', num: 2, title: 'Word Part Power-Ups', skill: 'wordParts', blurb: 'Prefixes, suffixes, and roots like re-, -less, and port.', icon: '🧬', bank: true },
    { id: 'homophones', subject: 'spelling', num: 3, title: 'Sound-Alike Words', skill: 'homophones', blurb: 'there, their, they\'re, your, you\'re, its, it\'s, and more.', icon: '👂', bank: true },
    { id: 'speech', subject: 'grammar', num: 1, title: 'Parts of Speech', skill: 'speech', blurb: 'Nouns, verbs, adjectives, and adverbs in game and sports sentences.', icon: '🏷️', bank: true },
    { id: 'mechanics', subject: 'grammar', num: 2, title: 'Punctuation & Agreement', skill: 'mechanics', blurb: 'Commas, apostrophes, quotation marks, and subject-verb agreement.', icon: '❗', bank: true },
    { id: 'sentences', subject: 'grammar', num: 3, title: 'Sentence Builder', skill: 'sentences', blurb: 'Fix run-ons and fragments, and combine short sentences.', icon: '🔗', bank: true },
    { id: 'gov', subject: 'citizenship', num: 1, title: 'How Government Works', skill: 'gov', blurb: 'Three branches, the Constitution, the Bill of Rights, and Texas government.', icon: '🏛️', bank: true },
    { id: 'citizen', subject: 'citizenship', num: 2, title: 'Be a Good Citizen', skill: 'citizen', blurb: 'Sportsmanship, helping your community, and staying safe and kind online.', icon: '🤝', bank: true },
    { id: 'matter', subject: 'science', num: 1, title: 'Matter Lab', skill: 'matter', blurb: 'Mass, sink or float, mixtures, solutions, states of matter, and conductors.', icon: '⚗️', bank: true },
    { id: 'force', subject: 'science', num: 2, title: 'Force, Motion & Energy', skill: 'force', blurb: 'Soccer kicks, baseball pitches, circuits, and how light reflects and bends.', icon: '🚀', bank: true },
    { id: 'earth', subject: 'science', num: 3, title: 'Earth, Space & Life', skill: 'earth', blurb: 'Day and night, the water cycle, landforms, and food chains.', icon: '🌎', bank: true },
    { id: 'geo', subject: 'social', num: 1, title: 'Maps & Regions', skill: 'geo', blurb: 'Map tools, U.S. regions, Texas, and the Gulf Coast.', icon: '🗺️', bank: true },
    { id: 'early', subject: 'social', num: 2, title: 'Colonies & Revolution', skill: 'early', blurb: 'Jamestown, the 13 colonies, and the fight for independence.', icon: '📜', bank: true },
    { id: 'nation', subject: 'social', num: 3, title: 'Constitution & Westward', skill: 'nation', blurb: 'The Constitution, the Louisiana Purchase, Texas statehood, and timelines.', icon: '🤠', bank: true }
  ];
  function moduleById(id) { for (var i = 0; i < MODULES.length; i++) if (MODULES[i].id === id) return MODULES[i]; return null; }
  function modulesFor(subject) { return MODULES.filter(function (m) { return m.subject === subject; }); }
  var SKILL_TO_MODULE = {};
  MODULES.forEach(function (m) { if (!SKILL_TO_MODULE[m.skill]) SKILL_TO_MODULE[m.skill] = m.id; });

  var BELTS = [
    { name: 'Recruit', xp: 0, color: '#cbd5e1', text: '#1e293b' },
    { name: 'Cadet', xp: 100, color: '#ffd400', text: '#222' },
    { name: 'Deputy', xp: 250, color: '#ff8a00', text: '#222' },
    { name: 'Officer', xp: 450, color: '#22a45d', text: '#fff' },
    { name: 'Senior Officer', xp: 700, color: '#1e6bff', text: '#fff' },
    { name: 'Detective', xp: 1000, color: '#7b3fe4', text: '#fff' },
    { name: 'Sergeant', xp: 1400, color: '#7a4a21', text: '#fff' },
    { name: 'Chief', xp: 2000, color: '#111', text: '#fff' }
  ];
  function beltIndexForXp(xp) { var idx = 0; for (var i = 0; i < BELTS.length; i++) if (xp >= BELTS[i].xp) idx = i; return idx; }
  function beltForXp(xp) { return BELTS[beltIndexForXp(xp)]; }
  function nextBelt(xp) { var i = beltIndexForXp(xp); return i < BELTS.length - 1 ? BELTS[i + 1] : null; }

  // ---------- question builders ----------
  var qCounter = 0;
  function mkId(prefix) { qCounter += 1; return prefix + '-' + Date.now().toString(36) + '-' + qCounter; }
  function base(module, skill, theme) { return { id: mkId(module), module: module, skill: skill, theme: theme }; }

  // Difficulty levels inside every module: 1 = Starter, 2 = 5th Grade, 3 = Challenge.
  var LEVELS = { 1: { name: 'Starter', badge: 'Level 1: Starter' }, 2: { name: '5th Grade', badge: 'Level 2: 5th Grade' }, 3: { name: 'Challenge', badge: 'Level 3: Challenge' } };
  function clampLevel(l) { l = Math.round(+l || 1); return l < 1 ? 1 : l > 3 ? 3 : l; }
  // Older callers pass only a step: early steps act like Level 1, middle steps Level 2, late steps Level 3.
  function levelOf(level, step) { return level ? clampLevel(level) : (step || 0) <= 1 ? 1 : (step || 0) <= 3 ? 2 : 3; }

  // Module 1: Warmup Ops
  var MULT = {
    fortnite: function (a, b) { return 'Your squad buys ' + a + ' skin bundles. Each one costs ' + b + ' V-Bucks. How many V-Bucks is that in all?'; },
    roblox: function (a, b) { return 'A pet egg costs ' + b + ' Robux. You hatch ' + a + ' eggs. How many Robux do you spend?'; },
    karate: function (a, b) { return 'Each kata you finish earns ' + b + ' belt points. You finish ' + a + ' katas this month. How many belt points do you earn?'; },
    soccer: function (a, b) { return 'Your team makes ' + b + ' passes in each drill. You run ' + a + ' drills. How many passes in all?'; },
    baseball: function (a, b) { return 'A pitcher throws ' + b + ' pitches in each game. He pitches ' + a + ' games. How many pitches is that?'; }
  };
  var DIV = {
    fortnite: function (t, k) { return t + ' wood is split evenly between ' + k + ' players in a tournament bracket. How much wood does each player get?'; },
    roblox: function (t, k) { return 'You split ' + t + ' Robux evenly between ' + k + ' friends. How many Robux does each friend get?'; },
    karate: function (t, k) { return t + ' kicks are split evenly across ' + k + ' rounds of practice. How many kicks are in each round?'; },
    soccer: function (t, k) { return t + ' orange slices are shared evenly by ' + k + ' teams. How many slices does each team get?'; },
    baseball: function (t, k) { return t + ' baseball cards are put into ' + k + ' equal stacks. How many cards are in each stack?'; }
  };
  var BRACKET = {
    fortnite: function (t, k) { return 'A Fortnite tournament has ' + t + ' players. They are put into squads of ' + k + '. How many squads are there?'; },
    roblox: function (t, k) { return 'A Roblox obby race has ' + t + ' players split into heats of ' + k + '. How many heats are there?'; },
    karate: function (t, k) { return 'A karate tournament has ' + t + ' kids split into brackets of ' + k + '. How many brackets are there?'; },
    soccer: function (t, k) { return 'A soccer camp has ' + t + ' players split into teams of ' + k + '. How many teams are there?'; },
    baseball: function (t, k) { return 'A baseball league has ' + t + ' players split into teams of ' + k + '. How many teams are there?'; }
  };
  function splitMult(a, b, partA, partB, label) {
    return {
      hints: ['Split ' + b + ' into ' + partA + ' and ' + partB + '.', a + ' × ' + partA + ' = ' + (a * partA) + '. Now find ' + a + ' × ' + partB + '.', 'Add the two answers together.'],
      steps: ['Split ' + b + ' into ' + partA + ' + ' + partB + '.', 'Multiply the ' + label + ': ' + a + ' × ' + partA + ' = ' + (a * partA) + '.', 'Multiply the rest: ' + a + ' × ' + partB + ' = ' + (a * partB) + '.', 'Add the parts: ' + (a * partA) + ' + ' + (a * partB) + ' = ' + (a * b) + '.'],
      explain: a + ' × ' + b + ' = (' + a + ' × ' + partA + ') + (' + a + ' × ' + partB + ') = ' + (a * partA) + ' + ' + (a * partB) + ' = ' + (a * b) + '.'
    };
  }
  function genWarmup(rng, theme, step, level) {
    var L = levelOf(level, step);
    var kind = pick(rng, L === 3 ? ['big', 'twoby', 'div', 'bracket'] : ['mult', 'div', 'bracket']);
    var q = base('warmup', 'ops', theme);
    q.answerType = 'number'; q.level = L;
    q.note = 'Break big numbers into hundreds, tens, and ones, multiply each part, then add.';
    if (kind === 'mult' || kind === 'big' || kind === 'twoby') {
      var a, b, parts;
      if (kind === 'big') { a = ri(rng, 3, 9); b = ri(rng, 105, 480); }
      else if (kind === 'twoby') { a = ri(rng, 11, 19); b = ri(rng, 12, 45); }
      else if (L === 1) { a = ri(rng, 2, 6); b = ri(rng, 11, 40); }
      else { a = ri(rng, 3, 9); b = ri(rng, 12, 89); }
      q.prompt = MULT[theme](a, b);
      q.answer = a * b;
      if (kind === 'big') { var h = Math.floor(b / 100) * 100; parts = splitMult(a, b, h, b - h, 'hundreds'); }
      else {
        var tens = Math.floor(b / 10) * 10, ones = b - tens;
        if (ones) parts = splitMult(a, b, tens, ones, 'tens');
        else parts = { hints: ['Think of ' + b + ' as ' + (b / 10) + ' tens.', a + ' × ' + (b / 10) + ' = ' + (a * b / 10) + ', so that many tens.', 'Put a zero on the end.'], steps: [b + ' is ' + (b / 10) + ' tens.', a + ' × ' + (b / 10) + ' = ' + (a * b / 10) + ', so the answer is ' + (a * b / 10) + ' tens.', (a * b / 10) + ' tens = ' + (a * b) + '.'], explain: a + ' × ' + b + ' = ' + (a * b / 10) + ' tens = ' + (a * b) + '.' };
      }
      q.hints = parts.hints; q.steps = parts.steps; q.explain = parts.explain;
      if (kind === 'twoby') q.note = 'Two-digit times two-digit: split one number into tens and ones, multiply both parts, then add.';
    } else {
      var k = L === 1 ? ri(rng, 2, 5) : ri(rng, 2, 9);
      var qq = kind === 'bracket' ? (L === 1 ? ri(rng, 4, 12) : L === 2 ? ri(rng, 6, 25) : ri(rng, 15, 60)) : (L === 1 ? ri(rng, 6, 15) : L === 2 ? ri(rng, 11, 49) : ri(rng, 25, 120));
      var t = k * qq, tp = Math.floor(qq / 10) * 10, chunk = k * tp, left = t - chunk;
      q.prompt = (kind === 'bracket' ? BRACKET : DIV)[theme](t, k);
      q.answer = qq;
      q.hints = ['Think: ' + k + ' times what number makes ' + t + '?', k + ' × 10 = ' + (k * 10) + '. How much is left after that?', 'Keep adding groups of ' + k + ' until you reach ' + t + '.'];
      q.steps = tp && left ? ['We need ' + t + ' ÷ ' + k + '. Ask: ' + k + ' times what number makes ' + t + '?', 'Take out a big chunk: ' + k + ' × ' + tp + ' = ' + chunk + '. That leaves ' + t + ' − ' + chunk + ' = ' + left + '.', 'Finish the rest: ' + left + ' ÷ ' + k + ' = ' + (qq - tp) + '.', 'Add the chunks: ' + tp + ' + ' + (qq - tp) + ' = ' + qq + '. Check: ' + k + ' × ' + qq + ' = ' + t + '.']
        : ['We need ' + t + ' ÷ ' + k + '. Ask: ' + k + ' times what number makes ' + t + '?', (tp ? 'Use tens: ' + k + ' × ' + (qq / 10) + ' = ' + (k * qq / 10) + ', so ' + k + ' × ' + qq + ' = ' + t + '.' : 'Count by ' + k + 's: ' + k + ' × ' + qq + ' = ' + t + '.'), 'So the answer is ' + qq + '.'];
      q.explain = t + ' ÷ ' + k + ' = ' + qq + ' because ' + k + ' × ' + qq + ' = ' + t + '.';
      q.note = 'Use multiplication facts to check division.';
    }
    return q;
  }

  // Module 2: Fraction Basics
  var IDENT = {
    fortnite: function (n, d) { return 'Your shield bar has ' + d + ' equal segments. ' + n + ' of them ' + be(n) + ' full. What fraction of your shield is full?'; },
    roblox: function (n, d) { return 'An obby has ' + d + ' equal stages. You beat ' + n + ' of them. What fraction of the obby did you beat?'; },
    karate: function (n, d) { return 'A kata has ' + d + ' equal parts. You have learned ' + n + ' of them. What fraction of the kata have you learned?'; },
    soccer: function (n, d) { return 'The practice field is split into ' + d + ' equal zones. Your team controls ' + n + ' zones. What fraction of the field do you control?'; },
    baseball: function (n, d) { return 'The dugout cooler has ' + d + ' equal sections. ' + n + ' ' + be(n) + ' filled with drinks. What fraction is filled?'; }
  };
  var LEFTOVER = {
    fortnite: function (n, d) { return 'Your shield bar has ' + d + ' equal segments. ' + n + ' of them ' + be(n) + ' full. What fraction of your shield is EMPTY?'; },
    roblox: function (n, d) { return 'An obby has ' + d + ' equal stages. You beat ' + n + ' of them. What fraction of the obby do you still have to beat?'; },
    karate: function (n, d) { return 'A kata has ' + d + ' equal parts. You have learned ' + n + ' of them. What fraction of the kata is still left to learn?'; },
    soccer: function (n, d) { return 'The field is split into ' + d + ' equal zones. Your team controls ' + n + ' zones. What fraction does the other team control?'; },
    baseball: function (n, d) { return 'The dugout cooler has ' + d + ' equal sections. ' + n + ' ' + be(n) + ' filled with drinks. What fraction is still empty?'; }
  };
  var SHADE = {
    fortnite: function (n, d) { return 'Your shield is at ' + n + '/' + d + '. Click the bar to shade ' + n + '/' + d + ' of it.'; },
    roblox: function (n, d) { return 'Your tycoon is ' + n + '/' + d + ' built. Click the bar to shade ' + n + '/' + d + ' of it.'; },
    karate: function (n, d) { return 'You finished ' + n + '/' + d + ' of your belt test. Click the bar to shade ' + n + '/' + d + ' of it.'; },
    soccer: function (n, d) { return 'You played ' + n + '/' + d + ' of the game. Click the bar to shade ' + n + '/' + d + ' of it.'; },
    baseball: function (n, d) { return 'Your team has played ' + n + '/' + d + ' of the game. Click the bar to shade ' + n + '/' + d + ' of it.'; }
  };
  var LINE = {
    fortnite: 'You are running from the storm (0) to the safe zone (1).',
    roblox: 'Your avatar is running an obby from the start (0) to the finish (1).',
    karate: 'The power meter for a board break goes from 0 to 1.',
    soccer: 'You are dribbling from your goal (0) to the other goal (1).',
    baseball: 'You are running from home plate (0) to first base (1).'
  };
  function genBasics(rng, theme, step, level) {
    var L = levelOf(level, step);
    var kind = pick(rng, L === 3 ? ['leftover', 'shade', 'line', 'leftover'] : ['identify', 'shade', 'line', L >= 2 ? 'shade' : 'identify']);
    var d = pick(rng, L === 1 ? [2, 3, 4] : L === 2 ? [5, 6, 8] : [6, 8, 10, 12]), n = ri(rng, 1, d - 1);
    var q = base('basics', 'fracIntro', theme);
    q.level = L;
    q.note = 'The bottom number is how many equal parts. The top is how many we count.';
    if (kind === 'identify') {
      q.prompt = IDENT[theme](n, d);
      q.answerType = 'fraction'; q.answer = frac(n, d);
      q.visual = { type: 'bar', n: n, d: d };
      q.hints = ['Count all the equal parts. That number goes on the bottom.', 'There are ' + d + ' parts in all, so the bottom is ' + d + '.', 'Now count the filled parts for the top number.'];
      q.steps = ['Count ALL the equal parts: there are ' + d + '. That is the bottom number.', 'Count the filled parts: there ' + be(n) + ' ' + n + '. That is the top number.', 'Put the top over the bottom: ' + n + '/' + d + '.'];
      q.explain = 'There are ' + d + ' equal parts and ' + n + ' ' + be(n) + ' filled, so the fraction is ' + n + '/' + d + '.';
    } else if (kind === 'leftover') {
      var m = d - n;
      q.prompt = LEFTOVER[theme](n, d);
      q.answerType = 'fraction'; q.answer = frac(m, d);
      q.visual = { type: 'bar', n: n, d: d };
      q.hints = ['The bottom number is still all the equal parts: ' + d + '.', 'This time count the parts that are NOT filled.', d + ' − ' + n + ' = ?'];
      q.steps = ['All the equal parts: ' + d + '. That is the bottom number.', 'Filled parts: ' + n + '. The question asks about the parts that are NOT filled.', 'Parts not filled: ' + d + ' − ' + n + ' = ' + m + '. That is the top number.', 'So the answer is ' + m + '/' + d + '.'];
      q.explain = d + ' parts in all, ' + n + ' filled, so ' + d + ' − ' + n + ' = ' + m + ' are left. The fraction left is ' + m + '/' + d + '.';
      q.note = 'The filled parts plus the empty parts make the whole: ' + n + '/' + d + ' + ' + m + '/' + d + ' = ' + d + '/' + d + ' = 1.';
    } else if (kind === 'shade') {
      q.prompt = SHADE[theme](n, d);
      q.answerType = 'shade'; q.answer = n; q.shadeD = d;
      q.visual = { type: 'shade', d: d };
      q.hints = ['The bar has ' + d + ' equal parts because the bottom number is ' + d + '.', 'The top number tells you how many parts to shade.', 'Click exactly ' + n + ' parts.'];
      q.steps = ['The bottom number is ' + d + ', so the bar is cut into ' + d + ' equal parts.', 'The top number is ' + n + ', so we shade ' + n + ' of those parts.', 'Click ' + n + ' parts and leave ' + (d - n) + ' empty.'];
      q.explain = n + '/' + d + ' means ' + n + ' out of ' + d + ' equal parts, so you shade ' + n + ' of the ' + d + ' parts.';
    } else {
      q.prompt = LINE[theme] + ' The line is split into ' + d + ' equal jumps. What fraction is the dot at?';
      q.answerType = 'fraction'; q.answer = frac(n, d);
      q.visual = { type: 'numberline', n: n, d: d };
      q.hints = ['Count the jumps from 0 to 1. That is the bottom number.', 'There are ' + d + ' jumps, so each one is 1/' + d + '.', 'Count how many jumps it takes to reach the dot.'];
      q.steps = ['Count the equal jumps from 0 to 1: there are ' + d + ', so each jump is 1/' + d + '.', 'Count the jumps from 0 to the dot: ' + n + '.', 'So the dot is at ' + n + '/' + d + '.'];
      q.explain = 'From 0 to 1 there are ' + d + ' equal jumps. The dot is ' + n + ' jumps in, so it is at ' + n + '/' + d + '.';
    }
    return q;
  }

  // Module 3: Equivalent & Simplifying
  var EQUIV = {
    fortnite: function (n, d, D) { return 'The storm timer is ' + n + '/' + d + ' done. If the timer is split into ' + D + ' equal ticks, how many ticks are done?'; },
    roblox: function (n, d, D) { return 'You get ' + n + '/' + d + ' of the Robux loot. If the loot is split into ' + D + ' equal shares, how many shares do you get?'; },
    karate: function (n, d, D) { return 'You finished ' + n + '/' + d + ' of class. If class is split into ' + D + ' equal parts, how many parts did you finish?'; },
    soccer: function (n, d, D) { return NAMES[D] ? 'You played ' + n + '/' + d + ' of the soccer game. How many ' + denName(D) + ' of the game is that? (?/' + D + ')' : 'You played ' + n + '/' + d + ' of the soccer game. If the game is split into ' + D + ' equal parts, how many parts did you play? (?/' + D + ')'; },
    baseball: function (n, d, D) { return 'Your team won ' + n + '/' + d + ' of its games. Out of ' + D + ' games, that would be how many wins?'; }
  };
  var SIMP = {
    fortnite: function (N, D) { return 'The storm timer shows ' + N + '/' + D + ' of the time used. Write ' + N + '/' + D + ' in simplest form.'; },
    roblox: function (N, D) { return 'In a loot split you get ' + N + '/' + D + ' of the Robux. Write ' + N + '/' + D + ' in simplest form.'; },
    karate: function (N, D) { return 'You landed ' + N + ' out of ' + D + ' kicks on the target. Write ' + N + '/' + D + ' in simplest form.'; },
    soccer: function (N, D) { return 'You played ' + N + '/' + D + ' of the match. Write ' + N + '/' + D + ' in simplest form.'; },
    baseball: function (N, D) { return 'Your team won ' + N + ' of its ' + D + ' games. Write ' + N + '/' + D + ' in simplest form.'; }
  };
  function genEquiv(rng, theme, step, level) {
    var L = levelOf(level, step);
    var kind = pick(rng, L === 1 ? ['make', 'which', 'make'] : ['make', 'simplify', 'which']);
    var d = pick(rng, L === 1 ? [2, 3, 4] : L === 2 ? [2, 3, 4, 5, 6] : [3, 4, 5, 6, 7]), n = ri(rng, 1, d - 1);
    var k = L === 1 ? 2 : L === 2 ? ri(rng, 2, d <= 3 ? 4 : 3) : ri(rng, 3, 6);
    while (gcd(n, d) !== 1) n = ri(rng, 1, d - 1);
    var N = n * k, D = d * k;
    var q = base('equiv', 'equiv', theme);
    q.level = L;
    q.note = 'Multiply or divide the top and bottom by the same number.';
    if (theme === 'soccer' && kind !== 'which' && L < 3) { d = pick(rng, [2, 4]); n = d === 2 ? 1 : pick(rng, [1, 3]); k = 2; N = n * k; D = d * k; }
    if (kind === 'make') {
      q.prompt = EQUIV[theme](n, d, D);
      q.answerType = 'number'; q.answer = N;
      q.visual = { type: 'bars', bars: [{ n: n, d: d, label: n + '/' + d }, { n: N, d: D, label: '?/' + D }], hideSecondShade: true };
      q.hints = ['The bottom went from ' + d + ' to ' + D + '. What did it get multiplied by?', d + ' × ' + k + ' = ' + D + ', so multiply by ' + k + '.', 'Multiply the top by ' + k + ' too: ' + n + ' × ' + k + ' = ?'];
      q.steps = ['Look at the bottoms: ' + d + ' became ' + D + '.', 'Find the multiplier: ' + d + ' × ' + k + ' = ' + D + ', so we multiplied by ' + k + '.', 'Do the same to the top: ' + n + ' × ' + k + ' = ' + N + '.', 'So ' + n + '/' + d + ' = ' + N + '/' + D + '. The answer is ' + N + '.'];
      q.explain = d + ' × ' + k + ' = ' + D + ', so multiply the top by ' + k + ' too: ' + n + ' × ' + k + ' = ' + N + '. So ' + n + '/' + d + ' = ' + N + '/' + D + '.';
    } else if (kind === 'simplify') {
      q.prompt = SIMP[theme](N, D);
      q.answerType = 'fraction'; q.answer = frac(n, d); q.requireSimplest = true;
      q.visual = { type: 'bars', bars: [{ n: N, d: D, label: N + '/' + D }, { n: n, d: d, label: '?' }], hideSecondShade: true };
      var g = gcd(N, D);
      q.hints = ['Find a number that divides evenly into both ' + N + ' and ' + D + '.', 'Both ' + N + ' and ' + D + ' can be divided by ' + g + '.', N + ' ÷ ' + g + ' = ?   and   ' + D + ' ÷ ' + g + ' = ?'];
      q.steps = ['Find the biggest number that goes into both ' + N + ' and ' + D + ': it is ' + g + '.', 'Divide the top: ' + N + ' ÷ ' + g + ' = ' + n + '.', 'Divide the bottom: ' + D + ' ÷ ' + g + ' = ' + d + '.', 'Nothing else goes into both ' + n + ' and ' + d + ', so ' + n + '/' + d + ' is simplest form.'];
      q.explain = 'Divide the top and bottom by ' + g + ': ' + N + ' ÷ ' + g + ' = ' + n + ' and ' + D + ' ÷ ' + g + ' = ' + d + '. So ' + N + '/' + D + ' = ' + n + '/' + d + '.';
    } else {
      var right = N + '/' + D;
      var pool = [(n + 1) + '/' + (d + 1), (n + k) + '/' + (d + k), N + '/' + (D + 1), (N + 1) + '/' + D, n + '/' + (d * k + 1), (n * k + 1) + '/' + (d * k), (N + 2) + '/' + (D + 1)];
      var wrong = [];
      for (var i = 0; i < pool.length && wrong.length < 3; i++) {
        var f = parseFraction(pool[i]);
        if (f && !equalsF(f, frac(n, d)) && wrong.indexOf(pool[i]) < 0 && pool[i] !== right) wrong.push(pool[i]);
      }
      var lead = { fortnite: 'Your squad mate says the storm is ' + n + '/' + d + ' closed.', roblox: 'You own ' + n + '/' + d + ' of the pets in a Roblox collection.', karate: 'You have earned ' + n + '/' + d + ' of the stripes for your next belt.', soccer: 'Your team had the ball for ' + n + '/' + d + ' of the game.', baseball: 'Your team got hits in ' + n + '/' + d + ' of its at-bats.' }[theme];
      q.prompt = lead + ' Which fraction is equal to ' + n + '/' + d + '?';
      q.answerType = 'choice'; q.choices = shuffle(rng, [right].concat(wrong)); q.answer = right;
      q.visual = { type: 'bar', n: n, d: d };
      q.hints = ['Equal fractions come from multiplying the top AND bottom by the same number.', 'Try multiplying ' + n + '/' + d + ' by ' + k + '/' + k + '.', n + ' × ' + k + ' = ' + N + ' and ' + d + ' × ' + k + ' = ' + D + '.'];
      q.steps = ['Equal fractions come from multiplying the top AND the bottom by the same number.', 'Try ' + k + ': ' + n + ' × ' + k + ' = ' + N + ' and ' + d + ' × ' + k + ' = ' + D + '.', 'So ' + n + '/' + d + ' = ' + N + '/' + D + '. That is the match.', 'Adding the same number to the top and bottom does NOT keep a fraction equal.'];
      q.explain = n + '/' + d + ' × ' + k + '/' + k + ' = ' + N + '/' + D + '. Adding the same number to top and bottom does NOT make an equal fraction.';
    }
    return q;
  }

  // Module 4: Comparing
  var WHO = {
    fortnite: { what: 'win rate', line: function (who, a, b) { return who + ' won ' + a + ' of ' + b + ' matches'; } },
    roblox: { what: 'obby clear rate', line: function (who, a, b) { return who + ' cleared ' + a + ' of ' + b + ' obby runs'; } },
    karate: { what: 'kick accuracy', line: function (who, a, b) { return who + ' landed ' + a + ' of ' + b + ' kicks'; } },
    soccer: { what: 'shot accuracy', line: function (who, a, b) { return who + ' scored on ' + a + ' of ' + b + ' penalty kicks'; } },
    baseball: { what: 'batting average', line: function (who, a, b) { return who + ' got ' + a + ' hits in ' + b + ' at-bats'; } }
  };
  var FRIENDS = ['Jace', 'Leo', 'Mason', 'Eli', 'Kai', 'Owen', 'Maya', 'Ava', 'Zoe', 'Nora'];
  function comparePair(rng, L) {
    var type = pick(rng, L === 1 ? ['sameD', 'sameN', 'sameD'] : L === 2 ? ['sameD', 'related', 'related', 'equal'] : ['related', 'unrelated', 'unrelated', 'equal']);
    var a, b, d, d2;
    if (type === 'sameD') { d = pick(rng, L === 1 ? [3, 4, 5, 6] : [4, 5, 6, 8, 10]); var x = ri(rng, 1, d - 1), y = ri(rng, 1, d - 1); while (y === x) y = ri(rng, 1, d - 1); a = frac(x, d); b = frac(y, d); }
    else if (type === 'sameN') { var nn = ri(rng, 1, 3); d = ri(rng, nn + 1, 6); d2 = ri(rng, nn + 1, 8); while (d2 === d) d2 = ri(rng, nn + 1, 8); a = frac(nn, d); b = frac(nn, d2); }
    else if (type === 'related') { d = pick(rng, [2, 3, 4, 5]); var m = pick(rng, L === 3 ? [3, 4] : [2, 3]); d2 = d * m; a = frac(ri(rng, 1, d - 1), d); var bn = ri(rng, 1, d2 - 1); while (bn * d === a.n * d2) bn = ri(rng, 1, d2 - 1); b = frac(bn, d2); }
    else if (type === 'equal') { d = pick(rng, L === 3 ? [3, 4, 5] : [2, 3, 4]); var n0 = ri(rng, 1, d - 1), k = pick(rng, L === 3 ? [3, 4] : [2, 3]); a = frac(n0, d); b = frac(n0 * k, d * k); }
    else { var pr = pick(rng, [[3, 4], [2, 3], [3, 5], [4, 5], [2, 5], [5, 6], [4, 7], [3, 8]]); a = frac(ri(rng, 1, pr[0] - 1), pr[0]); var bn2 = ri(rng, 1, pr[1] - 1); b = frac(bn2, pr[1]); if (equalsF(a, b)) b = frac(pr[1] - 1, pr[1]); }
    if (rng() < 0.5) { var t = a; a = b; b = t; }
    return [a, b];
  }
  function compareSteps(a, b) {
    var L = lcm(a.d, b.d), an = a.n * (L / a.d), bn = b.n * (L / b.d);
    return { L: L, an: an, bn: bn };
  }
  function genCompare(rng, theme, step, level) {
    var L = levelOf(level, step);
    var pr = comparePair(rng, L), a = pr[0], b = pr[1], c = compareF(a, b), s = compareSteps(a, b);
    var q = base('compare', 'equiv', theme);
    q.level = L;
    q.note = 'Give both fractions the same bottom number, then compare the tops.';
    q.visual = { type: 'bars', bars: [{ n: a.n, d: a.d, label: fstr(a) }, { n: b.n, d: b.d, label: fstr(b) }] };
    var sign = c > 0 ? ' > ' : c < 0 ? ' < ' : ' = ';
    var stepsHint = a.d === b.d ? 'The bottoms already match (' + a.d + ').' : fstr(a) + ' = ' + s.an + '/' + s.L + ' and ' + fstr(b) + ' = ' + s.bn + '/' + s.L + '.';
    var cmpWord = c > 0 ? 'greater than' : c < 0 ? 'less than' : 'equal to';
    if (rng() < 0.55) {
      var friend = pick(rng, FRIENDS), w = WHO[theme];
      q.prompt = w.line('You', a.n, a.d) + '. ' + w.line(friend, b.n, b.d) + '. Who has the better ' + w.what + '?';
      q.answerType = 'choice'; q.choices = ['You', friend, 'Tied'];
      q.answer = c > 0 ? 'You' : c < 0 ? friend : 'Tied';
      q.visual.bars[0].label = 'You: ' + fstr(a); q.visual.bars[1].label = friend + ': ' + fstr(b);
    } else {
      q.prompt = 'Pick the sign that makes this true:   ' + fstr(a) + '  ?  ' + fstr(b);
      q.answerType = 'choice'; q.choices = ['<', '=', '>'];
      q.answer = c > 0 ? '>' : c < 0 ? '<' : '=';
    }
    q.hints = ['Look at the bars. Which one is shaded farther?', a.d === b.d ? 'Same bottoms, so the bigger top wins.' : 'Make the bottoms match. Both ' + a.d + ' and ' + b.d + ' fit into ' + s.L + '.', stepsHint + ' Now compare ' + s.an + ' and ' + s.bn + '.'];
    q.steps = a.d === b.d
      ? ['The fractions are ' + fstr(a) + ' and ' + fstr(b) + '. The bottoms already match (' + a.d + '), so the pieces are the same size.', 'Just compare the tops: ' + a.n + sign + b.n + '.', 'So ' + fstr(a) + ' is ' + cmpWord + ' ' + fstr(b) + '.']
      : ['The fractions are ' + fstr(a) + ' and ' + fstr(b) + '. The bottoms are different, so the pieces are different sizes.', 'Find a bottom both fit into: ' + a.d + ' and ' + b.d + ' both go into ' + s.L + '.', 'Rewrite them: ' + fstr(a) + ' = ' + s.an + '/' + s.L + ' and ' + fstr(b) + ' = ' + s.bn + '/' + s.L + '.', 'Compare the tops: ' + s.an + sign + s.bn + ', so ' + fstr(a) + ' is ' + cmpWord + ' ' + fstr(b) + '.'];
    q.explain = stepsHint + ' Since ' + s.an + sign + s.bn + ', ' + fstr(a) + ' is ' + cmpWord + ' ' + fstr(b) + '.';
    return q;
  }

  // Module 5: Add & Subtract
  var ADD = {
    fortnite: function (a, b) { return 'A small shield potion fills ' + a + ' of your shield. Then a chug splash fills ' + b + ' more. How much of your shield is full now?'; },
    roblox: function (a, b) { return 'You build ' + a + ' of your tycoon on Saturday and ' + b + ' of it on Sunday. How much of the tycoon have you built?'; },
    karate: function (a, b) { return 'You spend ' + a + ' of class on kicks and ' + b + ' of class on katas. What fraction of class is that in all?'; },
    soccer: function (a, b) { return 'You run ' + a + ' of a mile in warmups and ' + b + ' of a mile in drills. How far do you run in all?'; },
    baseball: function (a, b) { return 'You eat ' + a + ' of a bag of sunflower seeds in the 1st inning and ' + b + ' of the bag in the 2nd. How much of the bag did you eat?'; }
  };
  var SUB = {
    fortnite: function (a, b) { return 'Your shield is at ' + a + '. You take a hit that knocks off ' + b + '. How much shield is left?'; },
    roblox: function (a, b) { return 'You have ' + a + ' of an obby left to finish. You clear ' + b + ' of it. How much is left now?'; },
    karate: function (a, b) { return 'Your water bottle is ' + a + ' full. You drink ' + b + ' of the bottle during sparring. How much is left?'; },
    soccer: function (a, b) { return 'You played ' + a + ' of the game. Your friend played ' + b + ' of the game. How much more did you play?'; },
    baseball: function (a, b) { return 'A roll of bat grip tape is ' + a + ' full. You use ' + b + ' of the roll. How much is left?'; }
  };
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function genAddSub(rng, theme, step, level) {
    var L = levelOf(level, step);
    var op = rng() < 0.6 ? '+' : '-';
    var a, b;
    if (L === 1) {
      var d = ri(rng, 4, 10);
      if (op === '+') { var x = ri(rng, 1, d - 2); var y = ri(rng, 1, d - x - 1 > 0 ? d - x - 1 : 1); a = frac(x, d); b = frac(y, d); }
      else { var x2 = ri(rng, 2, d - 1), y2 = ri(rng, 1, x2 - 1); a = frac(x2, d); b = frac(y2, d); }
    } else {
      var pairs = L === 2 ? [[2, 4], [2, 6], [3, 6], [4, 8], [2, 8], [5, 10]] : [[2, 3], [3, 4], [2, 5], [3, 5], [4, 6], [6, 8], [4, 10], [6, 9]];
      var tries = 0, bad;
      do {
        var p = pick(rng, pairs); if (rng() < 0.5) p = [p[1], p[0]];
        a = frac(ri(rng, 1, p[0] - 1), p[0]); b = frac(ri(rng, 1, p[1] - 1), p[1]);
        if (op === '-' && compareF(a, b) < 0) { var t = a; a = b; b = t; }
        tries++;
        bad = (op === '+' && compareF(addF(a, b), frac(1, 1)) > 0) || (op === '-' && compareF(a, b) === 0);
        if (!bad && L === 3 && tries < 40) { var r0 = op === '+' ? addF(a, b) : subF(a, b); if (isSimplest(r0) && rng() < 0.6) bad = true; }
      } while (tries < 80 && bad);
      if (op === '+' && compareF(addF(a, b), frac(1, 1)) > 0) { op = '-'; if (compareF(a, b) < 0) { var t2 = a; a = b; b = t2; } }
    }
    var res = op === '+' ? addF(a, b) : subF(a, b), simp = simplify(res);
    var q = base('addsub', 'addsub', theme);
    q.level = L;
    q.prompt = (op === '+' ? ADD : SUB)[theme](fstr(a), fstr(b)) + (L === 3 ? ' Give your answer in simplest form.' : '');
    q.answerType = 'fraction'; q.answer = L === 3 ? simp : res;
    if (L === 3) q.requireSimplest = true;
    q.visual = { type: 'addHelper', a: a, b: b, op: op };
    var verb = op === '+' ? 'add' : 'subtract';
    q.note = a.d === b.d ? 'Same bottoms: keep the bottom, ' + verb + ' the tops.' : 'Different bottoms: find a matching denominator first, then ' + verb + ' the tops' + (L === 3 ? ', then simplify.' : '.');
    var tail = (simp.n !== res.n) ? ' That simplifies to ' + fstr(simp) + '.' : '';
    var simpStep = simp.n !== res.n ? 'Simplify: divide the top and bottom of ' + res.n + '/' + res.d + ' by ' + gcd(res.n, res.d) + ' to get ' + fstr(simp) + '.' : res.n + '/' + res.d + ' is already in simplest form.';
    if (a.d === b.d) {
      q.hints = ['The bottoms already match. Keep the bottom number ' + a.d + '.', 'Just ' + verb + ' the tops: ' + a.n + ' ' + op + ' ' + b.n + '.', 'Put that over ' + a.d + '.'];
      q.steps = ['The bottoms match (' + a.d + '), so the pieces are the same size. Keep the bottom.', cap(verb) + ' the tops: ' + a.n + ' ' + op + ' ' + b.n + ' = ' + res.n + '.', 'Put it over the bottom: ' + res.n + '/' + res.d + '.', simpStep];
      q.explain = 'Same bottoms, so ' + verb + ' the tops: ' + a.n + ' ' + op + ' ' + b.n + ' = ' + res.n + '. Answer: ' + res.n + '/' + res.d + '.' + tail;
    } else {
      var LL = res.d, an = a.n * (LL / a.d), bn = b.n * (LL / b.d);
      q.hints = ['The bottoms are different, so first find a matching denominator. Try the "Find a matching denominator" button.', 'Both ' + a.d + ' and ' + b.d + ' fit into ' + LL + '. So ' + fstr(a) + ' = ' + an + '/' + LL + ' and ' + fstr(b) + ' = ' + bn + '/' + LL + '.', 'Now ' + verb + ' the tops: ' + an + ' ' + op + ' ' + bn + '. Keep the bottom ' + LL + '.'];
      q.steps = ['The bottoms are different (' + a.d + ' and ' + b.d + '), so we cannot ' + verb + ' yet.', 'Find a bottom both fit into: ' + LL + '.', 'Rewrite: ' + fstr(a) + ' = ' + an + '/' + LL + ' (times ' + (LL / a.d) + ') and ' + fstr(b) + ' = ' + bn + '/' + LL + ' (times ' + (LL / b.d) + ').', cap(verb) + ' the tops: ' + an + ' ' + op + ' ' + bn + ' = ' + res.n + '. So it is ' + res.n + '/' + LL + '.', simpStep];
      q.explain = 'Change to a matching bottom of ' + LL + ': ' + fstr(a) + ' = ' + an + '/' + LL + ' and ' + fstr(b) + ' = ' + bn + '/' + LL + '. Then ' + an + ' ' + op + ' ' + bn + ' = ' + res.n + ', so the answer is ' + res.n + '/' + LL + '.' + tail;
    }
    return q;
  }

  // Module 6: Game Day word problems
  var FRACOF = {
    fortnite: function (n, d, t) { return 'A Fortnite match lasts ' + t + ' minutes. You spend ' + n + '/' + d + ' of it building. How many minutes is that?'; },
    roblox: function (n, d, t) { return 'You have ' + t + ' Robux. You spend ' + n + '/' + d + ' of them on a game pass. How many Robux did the game pass cost?'; },
    karate: function (n, d, t) { return 'Karate class is ' + t + ' minutes long. ' + n + '/' + d + ' of class is sparring. How many minutes of sparring is that?'; },
    soccer: function (n, d, t) { return 'Your soccer game is ' + t + ' minutes long. You play ' + n + '/' + d + ' of the game. How many minutes do you play?'; },
    baseball: function (n, d, t) { return 'A coach has ' + t + ' baseballs. ' + n + '/' + d + ' of them are used for batting practice. How many baseballs is that?'; }
  };
  // Level 1: one step.
  function gameDayOne(rng, theme, q) {
    var x, y;
    if (theme === 'fortnite') {
      x = pick(rng, [200, 300, 500, 800]); y = x + ri(rng, 1, 16) * 50;
      q.prompt = 'You have ' + y + ' V-Bucks. You buy an emote that costs ' + x + ' V-Bucks. How many V-Bucks do you have left?';
      q.answer = y - x;
      q.hints = ['"Left" means take away.', 'Subtract: ' + y + ' − ' + x + '.', 'Take away the hundreds first.'];
      q.steps = ['"How many left" means subtract what you spent.', y + ' − ' + x + ' = ' + (y - x) + '.', 'So you have ' + (y - x) + ' V-Bucks left.'];
      q.explain = y + ' − ' + x + ' = ' + (y - x) + ' V-Bucks left.';
    } else if (theme === 'roblox') {
      x = ri(rng, 12, 40); y = ri(rng, 3, 9);
      q.prompt = 'Your tycoon makes ' + x + ' Robux every minute. How many Robux does it make in ' + y + ' minutes?';
      q.answer = x * y;
      q.hints = ['The same amount comes in every minute, so multiply.', x + ' × ' + y + ' = ?', 'Split ' + x + ' into tens and ones to multiply.'];
      q.steps = ['The tycoon makes the same amount each minute, so multiply.', x + ' × ' + y + ' = ' + (x * y) + '.', 'So it makes ' + (x * y) + ' Robux.'];
      q.explain = x + ' Robux × ' + y + ' minutes = ' + (x * y) + ' Robux.';
    } else if (theme === 'karate') {
      x = pick(rng, [10, 15, 20, 25]); y = ri(rng, 3, 8);
      q.prompt = 'Each karate class gives you ' + x + ' belt points. How many points do you earn in ' + y + ' classes?';
      q.answer = x * y;
      q.hints = ['Each class gives the same points, so multiply.', x + ' × ' + y + ' = ?', 'Count by ' + x + 's, ' + y + ' times.'];
      q.steps = ['Every class gives the same number of points, so multiply.', x + ' × ' + y + ' = ' + (x * y) + '.', 'So you earn ' + (x * y) + ' points.'];
      q.explain = x + ' points × ' + y + ' classes = ' + (x * y) + ' points.';
    } else if (theme === 'soccer') {
      x = pick(rng, [40, 50, 60, 70]); y = ri(rng, 2, 6);
      q.prompt = 'Each soccer game lasts ' + x + ' minutes. Your team plays ' + y + ' games this weekend. How many minutes of soccer is that?';
      q.answer = x * y;
      q.hints = ['Each game is the same length, so multiply.', x + ' × ' + y + ' = ?', 'Multiply ' + (x / 10) + ' × ' + y + ', then put a zero on the end.'];
      q.steps = ['Every game is ' + x + ' minutes, so multiply.', x + ' × ' + y + ' = ' + (x * y) + '.', 'So it is ' + (x * y) + ' minutes of soccer.'];
      q.explain = x + ' minutes × ' + y + ' games = ' + (x * y) + ' minutes.';
    } else {
      x = ri(rng, 2, 9); y = ri(rng, 2, 9);
      q.prompt = 'Your team scores ' + x + ' runs in the first game and ' + y + ' runs in the second game. How many runs is that in all?';
      q.answer = x + y;
      q.hints = ['"In all" means add.', x + ' + ' + y + ' = ?', 'Start at ' + x + ' and count up ' + y + '.'];
      q.steps = ['"In all" means put the two games together, so add.', x + ' + ' + y + ' = ' + (x + y) + '.', 'So the team scored ' + (x + y) + ' runs.'];
      q.explain = x + ' + ' + y + ' = ' + (x + y) + ' runs.';
    }
    q.note = 'Find the key words: "in all" means add, "left" means subtract, "each" often means multiply.';
  }
  // Level 2: two steps.
  function gameDayTwo(rng, theme, q) {
    if (theme === 'fortnite') {
      var c = ri(rng, 2, 3), p = pick(rng, [200, 300, 500, 800]), left = ri(rng, 0, 12) * 50, have = c * p + left;
      q.prompt = 'You have ' + have + ' V-Bucks. You buy ' + c + ' emotes that cost ' + p + ' V-Bucks each. How many V-Bucks do you have left?';
      q.answer = left;
      q.hints = ['Step 1: find the cost of all the emotes.', c + ' × ' + p + ' = ' + (c * p) + ' V-Bucks.', 'Step 2: take that away from ' + have + '.'];
      q.steps = ['Step 1: cost of all the emotes: ' + c + ' × ' + p + ' = ' + (c * p) + ' V-Bucks.', 'Step 2: take that away from what you had: ' + have + ' − ' + (c * p) + ' = ' + left + '.', 'So you have ' + left + ' V-Bucks left.'];
      q.explain = 'Step 1: ' + c + ' × ' + p + ' = ' + (c * p) + '. Step 2: ' + have + ' − ' + (c * p) + ' = ' + left + ' V-Bucks left.';
    } else if (theme === 'roblox') {
      var r = ri(rng, 15, 60), m = ri(rng, 3, 9), earned = r * m, s = ri(rng, 1, Math.floor(earned / 25)) * 25;
      if (s >= earned) s = earned - 5;
      q.prompt = 'Your tycoon makes ' + r + ' Robux every minute. After ' + m + ' minutes, you spend ' + s + ' Robux on an upgrade. How many Robux are left?';
      q.answer = earned - s;
      q.hints = ['Step 1: how many Robux did the tycoon make?', r + ' × ' + m + ' = ' + earned + ' Robux.', 'Step 2: subtract the ' + s + ' you spent.'];
      q.steps = ['Step 1: Robux made: ' + r + ' × ' + m + ' = ' + earned + '.', 'Step 2: take away what you spent: ' + earned + ' − ' + s + ' = ' + (earned - s) + '.', 'So ' + (earned - s) + ' Robux are left.'];
      q.explain = 'Step 1: ' + r + ' × ' + m + ' = ' + earned + '. Step 2: ' + earned + ' − ' + s + ' = ' + (earned - s) + ' Robux left.';
    } else if (theme === 'karate') {
      var per = pick(rng, [20, 25, 30, 40, 50]), classes = ri(rng, 3, 9), have2 = ri(rng, 2, 12) * 10, goal = have2 + per * classes;
      q.prompt = 'You need ' + goal + ' belt points for your next belt. You have ' + have2 + ' points. Each class gives you ' + per + ' points. How many more classes do you need?';
      q.answer = classes;
      q.hints = ['Step 1: how many more points do you need?', goal + ' − ' + have2 + ' = ' + (goal - have2) + ' points.', 'Step 2: divide that by ' + per + ' points per class.'];
      q.steps = ['Step 1: points still needed: ' + goal + ' − ' + have2 + ' = ' + (goal - have2) + '.', 'Step 2: classes needed: ' + (goal - have2) + ' ÷ ' + per + ' = ' + classes + '.', 'Check: ' + classes + ' × ' + per + ' = ' + (goal - have2) + '. So you need ' + classes + ' more classes.'];
      q.explain = 'Step 1: ' + goal + ' − ' + have2 + ' = ' + (goal - have2) + '. Step 2: ' + (goal - have2) + ' ÷ ' + per + ' = ' + classes + ' classes.';
    } else if (theme === 'soccer') {
      var g = ri(rng, 3, 6), h = pick(rng, [20, 25, 30, 35, 40, 45]), sat = ri(rng, 1, 3) * 5;
      q.prompt = 'Your team plays ' + g + ' games. Each game has 2 halves of ' + h + ' minutes. You sit out ' + sat + ' minutes total. How many minutes do you play?';
      q.answer = g * 2 * h - sat;
      q.hints = ['Step 1: how long is one game? 2 × ' + h + ' = ' + (2 * h) + ' minutes.', 'Step 2: ' + g + ' games × ' + (2 * h) + ' = ' + (g * 2 * h) + ' minutes.', 'Step 3: subtract the ' + sat + ' minutes you sat out.'];
      q.steps = ['Step 1: one game is 2 × ' + h + ' = ' + (2 * h) + ' minutes.', 'Step 2: all the games: ' + g + ' × ' + (2 * h) + ' = ' + (g * 2 * h) + ' minutes.', 'Step 3: take away the time you sat out: ' + (g * 2 * h) + ' − ' + sat + ' = ' + (g * 2 * h - sat) + '.'];
      q.explain = '2 × ' + h + ' = ' + (2 * h) + ' minutes per game. ' + g + ' × ' + (2 * h) + ' = ' + (g * 2 * h) + '. ' + (g * 2 * h) + ' − ' + sat + ' = ' + (g * 2 * h - sat) + ' minutes.';
    } else {
      var a = ri(rng, 1, 3), i = ri(rng, 3, 6), b = ri(rng, 2, 6);
      q.prompt = 'Your team scores ' + a + ' runs in each of the first ' + i + ' innings, then ' + b + ' runs in the last inning. How many runs in all?';
      q.answer = a * i + b;
      q.hints = ['Step 1: runs in the first ' + i + ' innings: ' + a + ' × ' + i + '.', a + ' × ' + i + ' = ' + (a * i) + ' runs.', 'Step 2: add the ' + b + ' runs from the last inning.'];
      q.steps = ['Step 1: runs in the first ' + i + ' innings: ' + a + ' × ' + i + ' = ' + (a * i) + '.', 'Step 2: add the last inning: ' + (a * i) + ' + ' + b + ' = ' + (a * i + b) + '.', 'So the team scored ' + (a * i + b) + ' runs.'];
      q.explain = a + ' × ' + i + ' = ' + (a * i) + '. Then ' + (a * i) + ' + ' + b + ' = ' + (a * i + b) + ' runs.';
    }
    q.note = 'Do one step at a time and write down each answer.';
  }
  // Level 3: three steps.
  function gameDayThree(rng, theme, q) {
    if (theme === 'fortnite') {
      var c = ri(rng, 2, 4), p = pick(rng, [200, 300, 400, 500]), left = ri(rng, 1, 10) * 50, have = c * p + left, bonus = pick(rng, [100, 150, 200, 250]);
      q.prompt = 'You have ' + have + ' V-Bucks. You buy ' + c + ' emotes for ' + p + ' V-Bucks each. Then you earn ' + bonus + ' V-Bucks from the Battle Pass. How many V-Bucks do you have now?';
      q.answer = left + bonus;
      q.steps = ['Step 1: cost of the emotes: ' + c + ' × ' + p + ' = ' + (c * p) + '.', 'Step 2: what is left after buying: ' + have + ' − ' + (c * p) + ' = ' + left + '.', 'Step 3: add the Battle Pass V-Bucks: ' + left + ' + ' + bonus + ' = ' + (left + bonus) + '.'];
      q.hints = ['Step 1: multiply to find what the emotes cost.', 'Step 2: subtract that from ' + have + '.', 'Step 3: add the ' + bonus + ' you earned.'];
      q.explain = c + ' × ' + p + ' = ' + (c * p) + '. ' + have + ' − ' + (c * p) + ' = ' + left + '. ' + left + ' + ' + bonus + ' = ' + (left + bonus) + ' V-Bucks.';
    } else if (theme === 'roblox') {
      var r = ri(rng, 15, 40), m = ri(rng, 4, 9), bonus2 = pick(rng, [50, 75, 100]), rm = r * m, earned = rm + bonus2, s = ri(rng, 2, Math.floor(earned / 50)) * 25;
      q.prompt = 'Your tycoon makes ' + r + ' Robux every minute for ' + m + ' minutes. You also get a ' + bonus2 + ' Robux daily bonus. Then you spend ' + s + ' Robux on a pet. How many Robux are left?';
      q.answer = earned - s;
      q.steps = ['Step 1: Robux from the tycoon: ' + r + ' × ' + m + ' = ' + rm + '.', 'Step 2: add the bonus: ' + rm + ' + ' + bonus2 + ' = ' + earned + '.', 'Step 3: take away the pet: ' + earned + ' − ' + s + ' = ' + (earned - s) + '.'];
      q.hints = ['Step 1: multiply ' + r + ' × ' + m + '.', 'Step 2: add the ' + bonus2 + ' bonus.', 'Step 3: subtract the ' + s + ' you spent.'];
      q.explain = r + ' × ' + m + ' = ' + rm + '. ' + rm + ' + ' + bonus2 + ' = ' + earned + '. ' + earned + ' − ' + s + ' = ' + (earned - s) + ' Robux.';
    } else if (theme === 'karate') {
      var per = pick(rng, [20, 25, 30, 40]), classes = ri(rng, 3, 8), have2 = ri(rng, 2, 10) * 10, tour = pick(rng, [50, 100]), goal = have2 + tour + per * classes, after = have2 + tour, need = goal - after;
      q.prompt = 'You need ' + goal + ' belt points for your next belt. You have ' + have2 + ' points, and this weekend\'s tournament will give you ' + tour + ' more. Each class gives ' + per + ' points. How many classes do you still need?';
      q.answer = classes;
      q.steps = ['Step 1: points after the tournament: ' + have2 + ' + ' + tour + ' = ' + after + '.', 'Step 2: points still needed: ' + goal + ' − ' + after + ' = ' + need + '.', 'Step 3: classes needed: ' + need + ' ÷ ' + per + ' = ' + classes + '.'];
      q.hints = ['Step 1: add the tournament points to what you have.', 'Step 2: subtract that from ' + goal + '.', 'Step 3: divide by ' + per + ' points per class.'];
      q.explain = have2 + ' + ' + tour + ' = ' + after + '. ' + goal + ' − ' + after + ' = ' + need + '. ' + need + ' ÷ ' + per + ' = ' + classes + ' classes.';
    } else if (theme === 'soccer') {
      var g = ri(rng, 3, 5), h = pick(rng, [25, 30, 35, 40]), ot = pick(rng, [10, 15, 20]), sat = ri(rng, 1, 4) * 5, reg = g * 2 * h, total = reg + ot;
      q.prompt = 'Your team plays ' + g + ' games with 2 halves of ' + h + ' minutes each. One game also goes to a ' + ot + ' minute overtime. You sit out ' + sat + ' minutes in all. How many minutes do you play?';
      q.answer = total - sat;
      q.steps = ['Step 1: one game is 2 × ' + h + ' = ' + (2 * h) + ' minutes, so all ' + g + ' games are ' + g + ' × ' + (2 * h) + ' = ' + reg + '.', 'Step 2: add the overtime: ' + reg + ' + ' + ot + ' = ' + total + '.', 'Step 3: take away the time you sat out: ' + total + ' − ' + sat + ' = ' + (total - sat) + '.'];
      q.hints = ['Step 1: find the minutes in all ' + g + ' regular games.', 'Step 2: add the ' + ot + ' overtime minutes.', 'Step 3: subtract the ' + sat + ' minutes you sat out.'];
      q.explain = g + ' × ' + (2 * h) + ' = ' + reg + '. ' + reg + ' + ' + ot + ' = ' + total + '. ' + total + ' − ' + sat + ' = ' + (total - sat) + ' minutes.';
    } else {
      var a = ri(rng, 1, 3), i = ri(rng, 3, 5), b = ri(rng, 2, 4), j = ri(rng, 2, 4), ours = a * i + b * j, opp = ri(rng, 2, ours - 1);
      q.prompt = 'Your team scores ' + a + ' runs in each of ' + i + ' innings and ' + b + ' runs in each of ' + j + ' more innings. The other team scores ' + opp + ' runs. How many more runs did your team score?';
      q.answer = ours - opp;
      q.steps = ['Step 1: first innings: ' + a + ' × ' + i + ' = ' + (a * i) + '. Next innings: ' + b + ' × ' + j + ' = ' + (b * j) + '.', 'Step 2: your team\'s total: ' + (a * i) + ' + ' + (b * j) + ' = ' + ours + '.', 'Step 3: "how many more" means subtract: ' + ours + ' − ' + opp + ' = ' + (ours - opp) + '.'];
      q.hints = ['Step 1: multiply to get the runs in each group of innings.', 'Step 2: add them for your team\'s total.', 'Step 3: subtract the other team\'s ' + opp + ' runs.'];
      q.explain = a + ' × ' + i + ' = ' + (a * i) + ' and ' + b + ' × ' + j + ' = ' + (b * j) + '. ' + (a * i) + ' + ' + (b * j) + ' = ' + ours + '. ' + ours + ' − ' + opp + ' = ' + (ours - opp) + ' more runs.';
    }
    q.note = 'Big word problems: underline each number, do one step at a time, and write each answer down.';
  }
  function genGameDay(rng, theme, step, level) {
    var L = levelOf(level, step);
    var q = base('gameday', 'word', theme);
    q.answerType = 'number'; q.level = L;
    if (L >= 2 && rng() < 0.3) {
      var d = pick(rng, L === 2 ? [2, 3, 4, 5] : [3, 4, 5, 6, 8]), n = ri(rng, 1, d - 1), each = ri(rng, 4, L === 2 ? 12 : 15), t = d * each;
      q.prompt = FRACOF[theme](n, d, t);
      q.answer = n * each;
      q.visual = { type: 'bar', n: n, d: d };
      q.hints = ['Split ' + t + ' into ' + d + ' equal groups first.', t + ' ÷ ' + d + ' = ' + each + ', so each group is ' + each + '.', 'You need ' + n + ' of those groups: ' + n + ' × ' + each + '.'];
      q.steps = ['The bottom number ' + d + ' says to split ' + t + ' into ' + d + ' equal groups: ' + t + ' ÷ ' + d + ' = ' + each + '.', 'The top number ' + n + ' says to take ' + n + ' of those groups: ' + n + ' × ' + each + ' = ' + (n * each) + '.', 'So ' + n + '/' + d + ' of ' + t + ' is ' + (n * each) + '.'];
      q.explain = t + ' ÷ ' + d + ' = ' + each + ' in each part. ' + n + ' parts is ' + n + ' × ' + each + ' = ' + (n * each) + '.';
      q.note = 'To find a fraction of a number, divide by the bottom, then multiply by the top.';
      return q;
    }
    if (L === 1) gameDayOne(rng, theme, q);
    else if (L === 2) gameDayTwo(rng, theme, q);
    else gameDayThree(rng, theme, q);
    return q;
  }

  // Module 7: Decimals & Money
  function money(c) { return '$' + (c / 100).toFixed(2); }
  function fmtDec(x) { return String(+(+x).toFixed(3)); }
  var ADDM = {
    fortnite: function (a, b) { return 'You buy a Fortnite gift card for ' + a + ' and a snack for ' + b + '. How much do you spend in all?'; },
    roblox: function (a, b) { return 'A Roblox gift card costs ' + a + ' and a controller grip costs ' + b + '. What is the total cost?'; },
    karate: function (a, b) { return 'New karate gloves cost ' + a + ' and a water bottle costs ' + b + '. How much is that together?'; },
    soccer: function (a, b) { return 'Shin guards cost ' + a + ' and soccer socks cost ' + b + '. What is the total?'; },
    baseball: function (a, b) { return 'At the ballpark, a hot dog costs ' + a + ' and a drink costs ' + b + '. How much is that in all?'; }
  };
  var SUBM = {
    fortnite: function (a, b) { return 'You have ' + a + '. You spend ' + b + ' on a Fortnite gift card. How much money is left?'; },
    roblox: function (a, b) { return 'You saved ' + a + '. A Roblox gift card costs ' + b + '. How much will you have left after you buy it?'; },
    karate: function (a, b) { return 'You have ' + a + '. You pay ' + b + ' for a new karate belt patch. How much is left?'; },
    soccer: function (a, b) { return 'You have ' + a + '. A new soccer ball costs ' + b + '. How much is left after you buy it?'; },
    baseball: function (a, b) { return 'You bring ' + a + ' to the game. You spend ' + b + ' on snacks. How much is left?'; }
  };
  var CHANGE = {
    fortnite: function (a, b, p) { return 'You buy a Fortnite gift card for ' + a + ' and a snack for ' + b + '. You pay with ' + p + '. How much change do you get back?'; },
    roblox: function (a, b, p) { return 'You buy a Roblox gift card for ' + a + ' and a controller grip for ' + b + '. You pay with ' + p + '. How much change do you get back?'; },
    karate: function (a, b, p) { return 'You buy karate gloves for ' + a + ' and a water bottle for ' + b + '. You pay with ' + p + '. How much change do you get back?'; },
    soccer: function (a, b, p) { return 'You buy shin guards for ' + a + ' and soccer socks for ' + b + '. You pay with ' + p + '. How much change do you get back?'; },
    baseball: function (a, b, p) { return 'At the ballpark you buy a hot dog for ' + a + ' and a drink for ' + b + '. You pay with ' + p + '. How much change do you get back?'; }
  };
  var CMPD = {
    fortnite: { w: [0, 0], line: function (a, b) { return 'Your accuracy this match is ' + a + '. Your squad mate\'s is ' + b + '. Which accuracy is higher?'; } },
    roblox: { w: [1, 3], line: function (a, b) { return 'One speed boost multiplies your speed by ' + a + '. Another multiplies it by ' + b + '. Which boost is bigger?'; } },
    karate: { w: [7, 9], line: function (a, b) { return 'Two judges give your kata scores of ' + a + ' and ' + b + '. Which score is higher?'; } },
    soccer: { w: [3, 6], line: function (a, b) { return 'One kick stays in the air for ' + a + ' seconds. Another stays up for ' + b + ' seconds. Which number is greater?'; } },
    baseball: { w: [0, 0], line: function (a, b) { return 'Player 1 has a batting average of ' + a + '. Player 2 has ' + b + '. Which average is higher?'; } }
  };
  var PLACE = {
    fortnite: 'Your damage boost is ', roblox: 'Your Roblox tycoon earns ', karate: 'Your kata score is ', soccer: 'Your fastest sprint was ', baseball: 'A pitch took '
  };
  var PLACE_END = { fortnite: '.', roblox: ' coins per second.', karate: ' points.', soccer: ' seconds.', baseball: ' seconds to reach the plate.' };
  function genDecimals(rng, theme, step, level) {
    var L = levelOf(level, step);
    var kind = pick(rng, L === 1 ? ['add', 'sub', 'compare', 'place'] : L === 2 ? ['add', 'sub', 'compare', 'compare', 'place'] : ['change', 'change', 'compare', 'place', 'sub']);
    var q = base('decimals', 'decimals', theme);
    q.level = L;
    if (kind === 'change') {
      var a0 = ri(rng, 215, 899), b0 = ri(rng, 105, 650), spent = a0 + b0, bill = spent < 1000 ? 1000 : 2000, back = bill - spent;
      q.prompt = CHANGE[theme](money(a0), money(b0), money(bill));
      q.answerType = 'decimal'; q.money = true; q.answer = back / 100;
      q.hints = ['Step 1: add the two prices to find what you spend.', money(a0) + ' + ' + money(b0) + ' = ' + money(spent) + '.', 'Step 2: subtract that from ' + money(bill) + '.'];
      q.steps = ['Step 1: total cost. Line up the decimal points: ' + money(a0) + ' + ' + money(b0) + ' = ' + money(spent) + '.', 'Step 2: change = money you paid − total cost.', money(bill) + ' − ' + money(spent) + ' = ' + money(back) + '.', 'So you get ' + money(back) + ' back.'];
      q.explain = money(a0) + ' + ' + money(b0) + ' = ' + money(spent) + '. Then ' + money(bill) + ' − ' + money(spent) + ' = ' + money(back) + ' in change.';
      q.note = 'Change = what you paid minus what it cost. Line up the decimal points every time.';
      return q;
    }
    if (kind === 'add' || kind === 'sub') {
      var a, b;
      if (L === 1) { if (kind === 'add') { a = ri(rng, 1, 6) * 100 + pick(rng, [0, 25, 50, 75]); b = ri(rng, 1, 3) * 100 + pick(rng, [0, 25, 50]); } else { a = ri(rng, 5, 9) * 100 + pick(rng, [0, 50, 75]); b = ri(rng, 1, 4) * 100 + pick(rng, [0, 25, 50]); } }
      else if (kind === 'add') { a = ri(rng, 125, 899); b = ri(rng, 50, 499); }
      else { a = ri(rng, 500, 999); b = ri(rng, 105, a - 50); }
      var res = kind === 'add' ? a + b : a - b, opS = kind === 'add' ? '+' : '−';
      q.prompt = (kind === 'add' ? ADDM : SUBM)[theme](money(a), money(b));
      q.answerType = 'decimal'; q.money = true; q.answer = res / 100;
      q.hints = ['Line up the decimal points, one on top of the other.', 'Work it like whole numbers: ' + a + ' ' + opS + ' ' + b + ' cents = ' + res + ' cents.', 'Put the decimal point back two places from the right.'];
      q.steps = ['Line up the decimal points: ' + money(a) + ' on top, ' + money(b) + ' below it.', 'Work it like whole numbers in cents: ' + a + ' ' + opS + ' ' + b + ' = ' + res + ' cents.', 'Put the decimal point back two places from the right: ' + money(res) + '.'];
      q.explain = money(a) + ' ' + opS + ' ' + money(b) + ' = ' + money(res) + '. Line up the decimal points, then ' + (kind === 'add' ? 'add' : 'subtract') + ' like whole numbers.';
      q.note = 'Line up the decimal points before you add or subtract.';
      return q;
    }
    if (kind === 'compare') {
      var cfg = CMPD[theme], w = ri(rng, cfg.w[0], cfg.w[1]), s1, s2, big, first;
      if (L === 1) {
        var t1 = ri(rng, 1, 9), t2 = ri(rng, 1, 9); while (t2 === t1) t2 = ri(rng, 1, 9);
        s1 = w + '.' + t1; s2 = w + '.' + t2; big = t1 > t2 ? s1 : s2;
        first = rng() < 0.5 ? [s1, s2] : [s2, s1];
        q.prompt = cfg.line(first[0], first[1]);
        q.answerType = 'choice'; q.choices = [first[0], first[1], 'They are equal']; q.answer = big;
        q.hints = ['Line up the decimal points.', 'The ones digits match, so look at the tenths digit.', 'Compare ' + t1 + ' tenths and ' + t2 + ' tenths.'];
        q.steps = ['Line up the decimal points: ' + s1 + ' and ' + s2 + '.', 'The ones digits are the same (' + w + ').', 'Compare the tenths: ' + Math.max(t1, t2) + ' tenths is more than ' + Math.min(t1, t2) + ' tenths, so ' + big + ' is greater.'];
        q.explain = 'Both have ' + w + ' ones. ' + Math.max(t1, t2) + ' tenths is more than ' + Math.min(t1, t2) + ' tenths, so ' + big + ' is greater.';
        q.note = 'Compare decimals place by place, starting from the left.';
        return q;
      }
      var h1 = ri(rng, 11, 98); while (h1 % 10 === 0) h1 = ri(rng, 11, 98);
      var t = ri(rng, 1, 9); while (t * 10 === h1) t = ri(rng, 1, 9);
      s1 = w + '.' + h1; s2 = w + '.' + t;
      big = h1 > t * 10 ? s1 : s2;
      first = rng() < 0.5 ? [s1, s2] : [s2, s1];
      q.prompt = cfg.line(first[0], first[1]);
      q.answerType = 'choice'; q.choices = [first[0], first[1], 'They are equal']; q.answer = big;
      q.hints = ['Line up the decimal points.', 'Add a zero so both have two digits after the point: ' + s2 + ' = ' + s2 + '0.', 'Now compare ' + h1 + ' hundredths and ' + (t * 10) + ' hundredths.'];
      q.steps = ['Line up the decimal points: ' + s1 + ' and ' + s2 + '.', 'Add a zero so both have two digits after the point: ' + s2 + ' = ' + s2 + '0.', 'Compare ' + h1 + ' hundredths with ' + (t * 10) + ' hundredths: ' + big + ' is greater.', 'More digits does NOT mean bigger.'];
      q.explain = 'Write ' + s2 + ' as ' + s2 + '0. Compare ' + h1 + ' hundredths with ' + (t * 10) + ' hundredths. ' + big + ' is greater. More digits does NOT mean bigger.';
      q.note = 'Add zeros so both decimals have the same number of digits, then compare.';
      return q;
    }
    var dg = shuffle(rng, [1, 2, 3, 4, 5, 6, 7, 8, 9]), whole = dg[0], tenths = dg[1], hund = dg[2], thou = dg[3];
    var askP = pick(rng, L === 1 ? ['tenths'] : L === 2 ? ['tenths', 'hundredths'] : ['hundredths', 'thousandths']);
    var num = whole + '.' + tenths + '' + hund + (L === 3 ? '' + thou : '');
    q.prompt = PLACE[theme] + num + PLACE_END[theme] + ' In ' + num + ', what digit is in the ' + askP + ' place?';
    q.answerType = 'number'; q.answer = askP === 'tenths' ? tenths : askP === 'hundredths' ? hund : thou;
    var count = askP === 'tenths' ? 'one place' : askP === 'hundredths' ? 'two places' : 'three places';
    q.hints = ['Find the decimal point first.', 'The first digit to the RIGHT of the point is tenths. The second is hundredths.' + (L === 3 ? ' The third is thousandths.' : ''), 'Count ' + count + ' to the right of the point.'];
    q.steps = ['Find the decimal point in ' + num + '.', 'Name the places to the right of it: ' + tenths + ' is tenths, ' + hund + ' is hundredths' + (L === 3 ? ', ' + thou + ' is thousandths' : '') + '.', 'The ' + askP + ' digit is ' + q.answer + '.'];
    q.explain = 'In ' + num + ', ' + whole + ' is in the ones place, ' + tenths + ' is in the tenths place, ' + (L === 3 ? hund + ' is in the hundredths place, and ' + thou + ' is in the thousandths place.' : 'and ' + hund + ' is in the hundredths place.');
    q.note = 'Right after the decimal point: tenths, then hundredths, then thousandths.';
    return q;
  }

  // Module 8: Geometry & Order of Operations
  var RECT = {
    fortnite: { lead: function (L, W) { return 'You build a rectangle of walls ' + L + ' tiles long and ' + W + ' tiles wide.'; }, unit: 'tiles', r: [4, 14] },
    roblox: { lead: function (L, W) { return 'Your Roblox plot is ' + L + ' studs long and ' + W + ' studs wide.'; }, unit: 'studs', r: [5, 15] },
    karate: { lead: function (L, W) { return 'A karate mat area is ' + L + ' feet long and ' + W + ' feet wide.'; }, unit: 'feet', r: [6, 15] },
    soccer: { lead: function (L, W) { return 'A small practice soccer field is ' + L + ' yards long and ' + W + ' yards wide.'; }, unit: 'yards', r: [20, 40] },
    baseball: { lead: function (L, W) { return 'The dugout floor is ' + L + ' feet long and ' + W + ' feet wide.'; }, unit: 'feet', r: [8, 20] }
  };
  var RECT_AREA = {
    fortnite: function (A, L) { return 'You build a rectangle floor that covers ' + A + ' square tiles. It is ' + L + ' tiles long.'; },
    roblox: function (A, L) { return 'Your Roblox plot covers ' + A + ' square studs. It is ' + L + ' studs long.'; },
    karate: function (A, L) { return 'A karate mat covers ' + A + ' square feet. It is ' + L + ' feet long.'; },
    soccer: function (A, L) { return 'A small practice field covers ' + A + ' square yards. It is ' + L + ' yards long.'; },
    baseball: function (A, L) { return 'The dugout floor covers ' + A + ' square feet. It is ' + L + ' feet long.'; }
  };
  var BOX = {
    fortnite: function (l, w, h) { return 'A supply drop crate is ' + l + ' units long, ' + w + ' units wide, and ' + h + ' units tall. What is its volume in cubic units?'; },
    roblox: function (l, w, h) { return 'You stack Roblox cube blocks into a box shape ' + l + ' blocks long, ' + w + ' blocks wide, and ' + h + ' blocks tall. How many cube blocks is that?'; },
    karate: function (l, w, h) { return 'A storage bin for karate pads is ' + l + ' feet long, ' + w + ' feet wide, and ' + h + ' feet tall. What is its volume in cubic feet?'; },
    soccer: function (l, w, h) { return 'Soccer balls are packed in a box ' + l + ' balls long, ' + w + ' balls wide, and ' + h + ' balls high. How many balls fit?'; },
    baseball: function (l, w, h) { return 'A crate of baseballs is packed ' + l + ' long, ' + w + ' wide, and ' + h + ' high. How many baseballs are in the crate?'; }
  };
  var OPS_LEAD = {
    fortnite: 'Your squad\'s points are figured like this: ', roblox: 'A Roblox script figures your coins like this: ', karate: 'Your belt points are figured like this: ', soccer: 'Your team\'s tournament points are figured like this: ', baseball: 'The scoreboard figures the runs like this: '
  };
  function genGeometry(rng, theme, step, level) {
    var Lv = levelOf(level, step);
    var kind = pick(rng, Lv === 3 ? ['perimeter', 'area', 'volume', 'ops', 'ops'] : ['perimeter', 'area', 'volume', 'ops']);
    var q = base('geometry', 'geometry', theme);
    q.answerType = 'number'; q.level = Lv;
    var cfg = RECT[theme];
    if (kind === 'perimeter' || kind === 'area') {
      var L, W;
      if (Lv === 1) { L = ri(rng, 3, 10); W = ri(rng, 2, L - 1); }
      else if (Lv === 3 && kind === 'area') { L = ri(rng, 12, 25); W = ri(rng, 11, L - 1); }
      else { L = ri(rng, cfg.r[0], cfg.r[1]); W = ri(rng, Math.max(2, Math.floor(cfg.r[0] / 2)), L - 1); }
      q.visual = { type: 'rect', L: L, W: W, unit: cfg.unit };
      if (kind === 'perimeter' && Lv === 3) {
        var A = L * W;
        q.prompt = RECT_AREA[theme](A, L) + ' What is its perimeter (the distance all the way around) in ' + cfg.unit + '?';
        q.answer = 2 * (L + W);
        q.hints = ['Step 1: find the width. Area = length × width, so width = area ÷ length.', A + ' ÷ ' + L + ' = ' + W + '.', 'Step 2: perimeter = 2 × (' + L + ' + ' + W + ').'];
        q.steps = ['Step 1: area = length × width, so width = area ÷ length: ' + A + ' ÷ ' + L + ' = ' + W + ' ' + cfg.unit + '.', 'Step 2: add one length and one width: ' + L + ' + ' + W + ' = ' + (L + W) + '.', 'Step 3: a rectangle has two of each, so double it: 2 × ' + (L + W) + ' = ' + (2 * (L + W)) + ' ' + cfg.unit + '.'];
        q.explain = 'Width = ' + A + ' ÷ ' + L + ' = ' + W + '. Perimeter = 2 × (' + L + ' + ' + W + ') = ' + (2 * (L + W)) + ' ' + cfg.unit + '.';
        q.note = 'Area = length × width. Perimeter = add all 4 sides.';
      } else if (kind === 'perimeter') {
        q.prompt = cfg.lead(L, W) + ' What is the perimeter (the distance all the way around) in ' + cfg.unit + '?';
        q.answer = 2 * (L + W);
        q.hints = ['Perimeter means add up all 4 sides.', 'A rectangle has two sides of ' + L + ' and two sides of ' + W + '.', L + ' + ' + W + ' + ' + L + ' + ' + W + ' = ?'];
        q.steps = ['Perimeter is the distance all the way around, so add all 4 sides.', 'A rectangle has two long sides (' + L + ') and two short sides (' + W + ').', L + ' + ' + W + ' + ' + L + ' + ' + W + ' = ' + (2 * (L + W)) + ' ' + cfg.unit + '.'];
        q.explain = L + ' + ' + W + ' + ' + L + ' + ' + W + ' = ' + (2 * (L + W)) + ' ' + cfg.unit + '. You can also do 2 × (' + L + ' + ' + W + ') = ' + (2 * (L + W)) + '.';
        q.note = 'Perimeter = add all the sides.';
      } else {
        q.prompt = cfg.lead(L, W) + ' What is the area in square ' + cfg.unit + '?';
        q.answer = L * W;
        q.hints = ['Area means how many squares cover the inside.', 'For a rectangle, area = length × width.', L + ' × ' + W + ' = ?'];
        q.steps = ['Area is how many squares cover the inside.', 'For a rectangle, area = length × width.', L + ' × ' + W + ' = ' + (L * W) + ' square ' + cfg.unit + '.'];
        q.explain = 'Area = length × width = ' + L + ' × ' + W + ' = ' + (L * W) + ' square ' + cfg.unit + '.';
        q.note = 'Area = length × width.';
      }
      return q;
    }
    if (kind === 'volume') {
      var l = Lv === 1 ? ri(rng, 2, 4) : Lv === 2 ? ri(rng, 2, 6) : ri(rng, 4, 9), w = Lv === 1 ? ri(rng, 2, 3) : Lv === 2 ? ri(rng, 2, 5) : ri(rng, 3, 7), h = Lv === 1 ? ri(rng, 2, 3) : Lv === 2 ? ri(rng, 2, 5) : ri(rng, 3, 6);
      q.prompt = BOX[theme](l, w, h);
      q.answer = l * w * h;
      q.visual = { type: 'box', L: l, W: w, H: h };
      q.hints = ['Volume = length × width × height.', 'First find one layer: ' + l + ' × ' + w + ' = ' + (l * w) + '.', 'Now multiply by the number of layers: ' + (l * w) + ' × ' + h + '.'];
      q.steps = ['Volume = length × width × height.', 'One layer on the bottom: ' + l + ' × ' + w + ' = ' + (l * w) + '.', 'There are ' + h + ' layers: ' + (l * w) + ' × ' + h + ' = ' + (l * w * h) + '.'];
      q.explain = l + ' × ' + w + ' = ' + (l * w) + ' in each layer. ' + (l * w) + ' × ' + h + ' layers = ' + (l * w * h) + '.';
      q.note = 'Volume = length × width × height.';
      return q;
    }
    var a, b, c, e, expr, ans, steps;
    if (Lv === 3) {
      var form3 = ri(rng, 1, 3);
      if (form3 === 1) { a = ri(rng, 2, 9); b = ri(rng, 2, 9); c = ri(rng, 2, 6); e = ri(rng, 1, (a + b) * c - 1); expr = '(' + a + ' + ' + b + ') × ' + c + ' − ' + e; ans = (a + b) * c - e; steps = ['Parentheses first: ' + a + ' + ' + b + ' = ' + (a + b) + '.', 'Multiply next: ' + (a + b) + ' × ' + c + ' = ' + ((a + b) * c) + '.', 'Subtract last: ' + ((a + b) * c) + ' − ' + e + ' = ' + ans + '.']; }
      else if (form3 === 2) { a = ri(rng, 2, 9); b = ri(rng, 2, 9); c = ri(rng, 2, 9); e = ri(rng, 2, 9); expr = a + ' × ' + b + ' + ' + c + ' × ' + e; ans = a * b + c * e; steps = ['No parentheses, so multiply first: ' + a + ' × ' + b + ' = ' + (a * b) + '.', 'Next multiplication: ' + c + ' × ' + e + ' = ' + (c * e) + '.', 'Add last: ' + (a * b) + ' + ' + (c * e) + ' = ' + ans + '.']; }
      else { c = ri(rng, 2, 6); b = c * ri(rng, 2, 9); a = ri(rng, 2, 9); e = ri(rng, 2, 9); expr = a + ' × ' + e + ' + ' + b + ' ÷ ' + c; ans = a * e + b / c; steps = ['Multiply and divide first, left to right: ' + a + ' × ' + e + ' = ' + (a * e) + '.', 'Then divide: ' + b + ' ÷ ' + c + ' = ' + (b / c) + '.', 'Add last: ' + (a * e) + ' + ' + (b / c) + ' = ' + ans + '.']; }
      q.prompt = OPS_LEAD[theme] + expr + '. What number do you get?';
      q.answer = ans; q.steps = steps;
      q.hints = ['Order of operations: Parentheses first, then multiply or divide, then add or subtract.', steps[0], steps[1]];
      q.explain = steps.join(' ');
      q.note = 'Parentheses first, then × and ÷ from left to right, then + and − from left to right.';
      return q;
    }
    var form = Lv === 1 ? pick(rng, [1, 2]) : ri(rng, 1, 5), first, firstVal;
    if (form === 1) { a = ri(rng, 2, Lv === 1 ? 10 : 20); b = ri(rng, 2, Lv === 1 ? 5 : 9); c = ri(rng, 2, Lv === 1 ? 5 : 9); expr = a + ' + ' + b + ' × ' + c; firstVal = b * c; first = b + ' × ' + c + ' = ' + firstVal; ans = a + firstVal; }
    else if (form === 2) { a = ri(rng, 2, Lv === 1 ? 5 : 9); b = ri(rng, 2, Lv === 1 ? 5 : 9); c = ri(rng, 2, Lv === 1 ? 4 : 6); expr = '(' + a + ' + ' + b + ') × ' + c; firstVal = a + b; first = a + ' + ' + b + ' = ' + firstVal; ans = firstVal * c; }
    else if (form === 3) { a = ri(rng, 3, 9); b = ri(rng, 3, 9); c = ri(rng, 1, a * b - 1); expr = a + ' × ' + b + ' − ' + c; firstVal = a * b; first = a + ' × ' + b + ' = ' + firstVal; ans = firstVal - c; }
    else if (form === 4) { c = ri(rng, 2, 6); b = c * ri(rng, 2, 9); a = ri(rng, b / c, 30); expr = a + ' − ' + b + ' ÷ ' + c; firstVal = b / c; first = b + ' ÷ ' + c + ' = ' + firstVal; ans = a - firstVal; }
    else { b = ri(rng, 2, 9); a = b + ri(rng, 1, 8); c = ri(rng, 2, 6); expr = '(' + a + ' − ' + b + ') × ' + c; firstVal = a - b; first = a + ' − ' + b + ' = ' + firstVal; ans = firstVal * c; }
    var rest = expr.replace(/^\([^)]*\)/, String(firstVal));
    if (rest === expr) rest = form === 1 ? a + ' + ' + firstVal : form === 3 ? firstVal + ' − ' + c : a + ' − ' + firstVal;
    q.prompt = OPS_LEAD[theme] + expr + '. What number do you get?';
    q.answer = ans;
    q.hints = ['Order of operations: Parentheses first, then multiply or divide, then add or subtract.', 'Do this part first: ' + first + '.', 'Now finish it: ' + rest + ' = ?'];
    q.steps = ['Order of operations: Parentheses first, then × and ÷, then + and −.', 'Do this part first: ' + first + '.', 'Now finish it: ' + rest + ' = ' + ans + '.'];
    q.explain = 'First ' + first + '. Then ' + rest + ' = ' + ans + '.';
    q.note = 'Parentheses first, then × and ÷, then + and −.';
    return q;
  }

  // ---------- bank modules (Reading, Spelling, Grammar, Citizenship, Science, Social Studies) ----------
  var PASSAGES = (Bank && Bank.PASSAGES) || [];
  var BANK = (Bank && Bank.BANK) || {};
  // Difficulty tiers for written items. An item can set `level` itself in bank.js; otherwise each module's items are
  // ranked by how much reading and thinking they take (typed answers count extra) and split into thirds.
  function itemWeight(it) { return String(it.prompt).length + 0.6 * String(it.explain).length + (it.answerType === 'text' ? 120 : 0) + (it.wrongs ? it.wrongs.join(' ').length * 0.4 : 0); }
  function assignTiers(list, weightFn) {
    var order = list.map(function (it, i) { return { i: i, w: weightFn(it) }; }).sort(function (x, y) { return x.w - y.w || x.i - y.i; });
    order.forEach(function (o, rank) { var it = list[o.i]; if (!it.level) it.level = 1 + Math.min(2, Math.floor(rank * 3 / list.length)); });
  }
  Object.keys(BANK).forEach(function (k) { assignTiers(BANK[k], itemWeight); });
  assignTiers(PASSAGES, function (p) { return p.text.length + p.questions.reduce(function (a, it) { return a + it.prompt.length; }, 0); });
  PASSAGES.forEach(function (p) { p.questions.forEach(function (it) { if (!it.level) it.level = p.level; }); });

  function modSkill(id) { var m = moduleById(id); return m ? m.skill : null; }
  function fromItem(mod, it, rng, passage) {
    var q = base(mod, modSkill(mod), it.theme);
    q.answerType = it.answerType; q.prompt = it.prompt; q.answer = it.answer; q.explain = it.explain; q.hints = it.hints.slice(); q.note = it.note;
    q.level = it.level || 1;
    q.steps = it.steps ? it.steps.slice() : it.hints.concat([it.explain]);
    if (it.answerType === 'choice') q.choices = shuffle(rng, [it.answer].concat(it.wrongs));
    if (passage) q.passage = { title: passage.title, text: passage.text };
    return q;
  }
  // Theme first (so a theme filter still leads), then the closest difficulty to his level, then random.
  function themedOrder(rng, list, theme, level) {
    var keyed = list.map(function (x) { return { x: x, r: rng() }; });
    var useTheme = theme && theme !== 'all';
    keyed.sort(function (a, b) {
      if (useTheme) { var ta = a.x.theme === theme ? 0 : 1, tb = b.x.theme === theme ? 0 : 1; if (ta !== tb) return ta - tb; }
      if (level) { var da = Math.abs((a.x.level || 1) - level), db = Math.abs((b.x.level || 1) - level); if (da !== db) return da - db; }
      return a.r - b.r;
    });
    return keyed.map(function (k) { return k.x; });
  }
  function bankRound(mod, theme, rng, count, level) {
    if (mod === 'reading') {
      var p = themedOrder(rng, PASSAGES, theme, level)[0];
      return p.questions.slice(0, count).map(function (it) { return fromItem('reading', it, rng, p); });
    }
    return themedOrder(rng, BANK[mod], theme, level).slice(0, count).map(function (it) { return fromItem(mod, it, rng); });
  }
  function bankQuestion(mod, theme, rng, level) {
    if (mod === 'reading') { var p = themedOrder(rng, PASSAGES, theme, level)[0]; return fromItem('reading', pick(rng, p.questions), rng, p); }
    return fromItem(mod, themedOrder(rng, BANK[mod], theme, level)[0], rng);
  }

  var GENERATORS = { warmup: genWarmup, basics: genBasics, equiv: genEquiv, compare: genCompare, addsub: genAddSub, gameday: genGameDay, decimals: genDecimals, geometry: genGeometry };
  function decorate(q) {
    var m = moduleById(q.module); q.subject = m ? m.subject : 'math';
    q.level = clampLevel(q.level || 1);
    if (!Array.isArray(q.steps) || !q.steps.length) q.steps = (q.hints || []).concat([q.explain]);
    return q;
  }
  function skillLevel(state, skill) { var s = state && state.skill && state.skill[skill]; return s ? clampLevel(s.level) : 1; }
  function moduleLevel(state, moduleId) { var m = moduleById(moduleId); return state && m ? skillLevel(state, m.skill) : null; }

  // level: 1 | 2 | 3 (his current level for that skill). Leave it out to ramp up by step like before.
  function generateQuestion(moduleId, theme, rng, step, level) {
    rng = rng || Math.random;
    var m = moduleById(moduleId);
    if (!m) throw new Error('Unknown module ' + moduleId);
    if (m.bank) return decorate(bankQuestion(moduleId, theme, rng, level ? clampLevel(level) : null));
    var t = (!theme || theme === 'all') ? pick(rng, THEME_KEYS) : theme;
    if (!THEMES[t]) t = pick(rng, THEME_KEYS);
    return decorate(GENERATORS[moduleId](rng, t, step || 0, level ? clampLevel(level) : null));
  }
  // state (optional): when given, every question uses his current level for that module's skill.
  function generateRound(moduleId, theme, rng, count, state) {
    count = count || 5; rng = rng || Math.random;
    var m = moduleById(moduleId);
    if (!m) throw new Error('Unknown module ' + moduleId);
    var level = moduleLevel(state, moduleId);
    if (m.bank) return bankRound(moduleId, theme, rng, count, level).map(function (q, i) { q.step = i; return decorate(q); });
    var out = [], seen = {};
    for (var i = 0; i < count; i++) {
      var q, tries = 0;
      do { q = generateQuestion(moduleId, theme, rng, i, level); tries++; } while (seen[q.prompt] && tries < 20);
      seen[q.prompt] = true; q.step = i; out.push(q);
    }
    return out;
  }

  // A short worked example for the "How to solve it" card after a miss.
  function walkthrough(q, given) {
    var steps = (Array.isArray(q.steps) && q.steps.length ? q.steps : (q.hints || []).concat([q.explain])).filter(Boolean);
    var out = { answer: answerText(q), steps: steps.slice(), explain: q.explain || '', rule: q.note || '', compare: null };
    if (q.answerType === 'fraction' && given) {
      var g = parseFraction(given);
      if (g && g.d > 0 && g.d <= 24 && g.n >= 0 && g.n <= g.d) out.compare = { given: g, answer: q.answer };
    }
    if (q.answerType === 'shade' && typeof given === 'number') out.compare = { given: frac(given, q.shadeD), answer: frac(q.answer, q.shadeD) };
    return out;
  }

  // ---------- placement ----------
  var MATH_PLACEMENT = [
    { pid: 'p1', area: 'ops', answerType: 'number', answer: 282, prompt: 'Your squad buys 6 emote bundles. Each costs 47 V-Bucks. How many V-Bucks in all?', explain: '6 × 47 = (6 × 40) + (6 × 7) = 240 + 42 = 282.', note: 'Break 47 into 40 and 7.' },
    { pid: 'p2', area: 'ops', answerType: 'number', answer: 48, prompt: '384 Robux are split evenly between 8 friends. How many Robux does each friend get?', explain: '384 ÷ 8 = 48 because 8 × 48 = 384.', note: 'Use multiplication to check division.' },
    { pid: 'p3', area: 'word', answerType: 'number', answer: 400, prompt: 'You have 1,000 V-Bucks. You buy 3 emotes that cost 200 V-Bucks each. How many V-Bucks are left?', explain: '3 × 200 = 600. Then 1,000 − 600 = 400.', note: 'Two steps: multiply, then subtract.' },
    { pid: 'p4', area: 'word', answerType: 'number', answer: 22, prompt: 'Your baseball team scores 3 runs in each of 4 innings, then 5 runs in each of 2 more innings. How many runs in all?', explain: '3 × 4 = 12 and 5 × 2 = 10. Then 12 + 10 = 22.', note: 'Find each part, then add them.' },
    { pid: 'p5', area: 'fracIntro', answerType: 'fraction', answer: { n: 3, d: 8 }, visual: { type: 'bar', n: 3, d: 8 }, prompt: 'Your shield bar has 8 equal segments. What fraction of the bar is shaded?', explain: '3 of the 8 equal parts are shaded, so it is 3/8.', note: 'Bottom = total parts, top = shaded parts.' },
    { pid: 'p6', area: 'fracIntro', answerType: 'fraction', answer: { n: 3, d: 4 }, visual: { type: 'numberline', n: 3, d: 4 }, prompt: 'You run from home plate (0) to first base (1). What fraction is the dot at?', explain: 'The line has 4 equal jumps. The dot is 3 jumps in, so it is 3/4.', note: 'Count the jumps from 0 to 1.' },
    { pid: 'p7', area: 'equiv', answerType: 'choice', choices: ['2/3', '3/6', '2/5', '4/6'], answer: '3/6', visual: { type: 'bar', n: 1, d: 2 }, prompt: 'You played 1/2 of the soccer game. Which fraction is equal to 1/2?', explain: '1/2 × 3/3 = 3/6. Half of 6 is 3.', note: 'Multiply top and bottom by the same number.' },
    { pid: 'p8', area: 'equiv', answerType: 'choice', choices: ['2/3', '3/4', 'They are equal'], answer: '3/4', visual: { type: 'bars', bars: [{ n: 2, d: 3, label: 'Jace: 2/3' }, { n: 3, d: 4, label: 'Leo: 3/4' }] }, prompt: 'Jace won 2/3 of his Fortnite matches. Leo won 3/4 of his. Which win rate is bigger?', explain: '2/3 = 8/12 and 3/4 = 9/12. 9 is more than 8, so 3/4 is bigger.', note: 'Make the bottoms match, then compare.' },
    { pid: 'p9', area: 'addsub', answerType: 'fraction', answer: { n: 3, d: 5 }, visual: { type: 'addHelper', a: { n: 2, d: 5 }, b: { n: 1, d: 5 }, op: '+' }, prompt: 'You beat 2/5 of a Roblox obby yesterday and 1/5 today. How much of the obby have you beaten?', explain: 'Same bottoms, so add the tops: 2 + 1 = 3. Answer: 3/5.', note: 'Same bottoms: add the tops.' },
    { pid: 'p10', area: 'addsub', answerType: 'fraction', answer: { n: 3, d: 4 }, visual: { type: 'addHelper', a: { n: 1, d: 2 }, b: { n: 1, d: 4 }, op: '+' }, prompt: 'You run 1/2 of a mile in soccer warmups and 1/4 of a mile in drills. How far do you run?', explain: '1/2 = 2/4. Then 2/4 + 1/4 = 3/4 of a mile.', note: 'Different bottoms: find a matching denominator.' },
    { pid: 'p11', area: 'decimals', answerType: 'choice', choices: ['0.45', '0.5', 'They are equal'], answer: '0.5', prompt: 'Your batting average is 0.45. Your friend\'s batting average is 0.5. Which one is higher?', explain: '0.5 is the same as 0.50. 50 hundredths is more than 45 hundredths, so 0.5 is higher.', note: 'Add a zero so both decimals have the same number of digits.' },
    { pid: 'p12', area: 'geometry', answerType: 'number', answer: 40, visual: { type: 'rect', L: 8, W: 5, unit: 'studs' }, prompt: 'Your Roblox plot is 8 studs long and 5 studs wide. What is its area in square studs?', explain: 'Area = length × width = 8 × 5 = 40 square studs.', note: 'Area = length × width.' }
  ];
  var KAI = { title: 'Kai\'s Left Foot', text: 'Kai wanted to make the school soccer team, but he could not kick well with his left foot. Every day after school, he kicked a ball against the garage wall 50 times with his left foot. At first, the ball flew everywhere. He kept going anyway. After three weeks, his left-footed kicks were straight and strong. At tryouts, the coach watched Kai score with his left foot and put him on the team.' };
  var KAI_Q = {
    main: { area: 'readComp', answerType: 'choice', passage: KAI, prompt: 'What is the main idea of this story?', answer: 'Kai\'s daily practice helped him make the team.', choices: ['Kai\'s daily practice helped him make the team.', 'Kai does not like soccer.', 'Garage walls are good for soccer.', 'The coach picked players at random.'], explain: 'The whole story is about Kai practicing every day until his left foot got good enough to make the team.', note: 'The main idea is what the whole story is mostly about.' },
    infer: { area: 'readComp', answerType: 'choice', passage: KAI, prompt: 'Which word best describes Kai?', answer: 'Determined', choices: ['Determined', 'Lazy', 'Shy', 'Careless'], explain: 'He practiced every day for three weeks, even when the ball flew everywhere. That shows he is determined, which means he does not give up.', note: 'Use what a character does to figure out what he is like.' }
  };
  function fromBankRef(pid, mod, idx) {
    var it = BANK[mod][idx];
    return { pid: pid, area: modSkill(mod), answerType: it.answerType, prompt: it.prompt, answer: it.answer, choices: it.answerType === 'choice' ? [it.answer].concat(it.wrongs) : undefined, explain: it.explain, note: it.note, mix: true };
  }
  function clone(pid, p) { var o = JSON.parse(JSON.stringify(p)); o.pid = pid; return o; }
  function kai(pid, key) { var o = clone(pid, KAI_Q[key]); o.mix = true; return o; }
  var PLACEMENT_SETS = {
    full: [clone('pf1', MATH_PLACEMENT[0]), clone('pf2', MATH_PLACEMENT[4]), clone('pf3', MATH_PLACEMENT[8]), clone('pf4', MATH_PLACEMENT[10]),
      kai('pf5', 'main'), fromBankRef('pf6', 'clues', 3),
      fromBankRef('pf7', 'spell', 0), fromBankRef('pf8', 'homophones', 1),
      fromBankRef('pf9', 'mechanics', 0), fromBankRef('pf10', 'mechanics', 1),
      fromBankRef('pf11', 'gov', 0), fromBankRef('pf12', 'citizen', 2),
      fromBankRef('pf13', 'matter', 0), fromBankRef('pf14', 'earth', 6),
      fromBankRef('pf15', 'early', 7), fromBankRef('pf16', 'geo', 1)],
    math: MATH_PLACEMENT,
    ela: [kai('pe1', 'main'), kai('pe2', 'infer'), fromBankRef('pe3', 'clues', 6),
      fromBankRef('pe4', 'spell', 3), fromBankRef('pe5', 'spell', 9), fromBankRef('pe6', 'homophones', 3),
      fromBankRef('pe7', 'mechanics', 2), fromBankRef('pe8', 'sentences', 2), fromBankRef('pe9', 'mechanics', 4)],
    world: [fromBankRef('pw1', 'gov', 3), fromBankRef('pw2', 'gov', 7), fromBankRef('pw3', 'citizen', 7),
      fromBankRef('pw4', 'matter', 5), fromBankRef('pw5', 'force', 9), fromBankRef('pw6', 'earth', 2),
      fromBankRef('pw7', 'geo', 9), fromBankRef('pw8', 'early', 6), fromBankRef('pw9', 'nation', 1)]
  };
  var PLACEMENT_INFO = {
    full: { label: 'Full Placement Check', short: 'All 7 subjects', minutes: 10 },
    math: { label: 'Math-Only Check', short: 'Just math', minutes: 6 },
    ela: { label: 'Reading & Writing Check', short: 'Reading, spelling, and grammar', minutes: 6 },
    world: { label: 'Science, Social Studies & Citizenship Check', short: 'Citizenship, science, and social studies', minutes: 5 }
  };
  var PLACEMENT_KINDS = ['full', 'math', 'ela', 'world'];
  var ALL_PLACEMENT = {};
  PLACEMENT_KINDS.forEach(function (k) {
    PLACEMENT_SETS[k].forEach(function (p, i) {
      p.skill = p.area; p.module = 'placement'; p.id = p.pid; p.subject = SKILLS[p.area].subject; p.kind = k;
      if (p.mix && p.choices) {
        var seed = 0; for (var c = 0; c < p.pid.length; c++) seed = seed * 31 + p.pid.charCodeAt(c);
        var sh = shuffle(mulberry32(seed + 7), p.choices); if (sh[0] === p.answer && i % 2 === 0) sh.push(sh.shift());
        p.choices = sh;
      }
      ALL_PLACEMENT[p.pid] = p;
    });
  });
  var PLACEMENT = PLACEMENT_SETS.full;

  function beltForPct(pct) { return pct < 0.25 ? 'Recruit' : pct < 0.55 ? 'Cadet' : pct < 0.85 ? 'Deputy' : 'Officer'; }
  function beltByName(name) { for (var i = 0; i < BELTS.length; i++) if (BELTS[i].name === name) return BELTS[i]; return BELTS[0]; }

  // results: [{pid, correct:bool, skipped:bool}]
  function scorePlacement(results, kind) {
    kind = kind || 'full';
    var set = PLACEMENT_SETS[kind] || PLACEMENT_SETS.full;
    var perArea = {}, perSubject = {}, score = 0;
    set.forEach(function (p) {
      if (!perArea[p.area]) perArea[p.area] = { correct: 0, total: 0 };
      if (!perSubject[p.subject]) perSubject[p.subject] = { correct: 0, total: 0 };
    });
    results.forEach(function (r) {
      var p = ALL_PLACEMENT[r.pid];
      if (!p || !perArea[p.area]) return;
      perArea[p.area].total += 1; perSubject[p.subject].total += 1;
      if (r.correct) { perArea[p.area].correct += 1; perSubject[p.subject].correct += 1; score += 1; }
    });
    var total = set.length, belt = beltForPct(score / total), st = startFrom(perArea, perSubject);
    return { kind: kind, score: score, total: total, perArea: perArea, perSubject: perSubject, belt: belt, startSubject: st.startSubject, startSkill: st.startSkill, startModule: st.startModule };
  }
  // starting module: weakest subject (lowest share right, learning order breaks ties), then its weakest skill
  function startFrom(perArea, perSubject) {
    var subj = null, best = 2;
    SUBJECT_ORDER.forEach(function (s) { var x = perSubject[s]; if (!x || !x.total) return; var pct = x.correct / x.total; if (pct < best - 1e-9) { best = pct; subj = s; } });
    var startSkill = null, bestS = 2;
    skillsFor(subj || 'math').forEach(function (k) { var x = perArea[k]; if (!x || !x.total) return; var pct = x.correct / x.total; if (pct < bestS - 1e-9) { bestS = pct; startSkill = k; } });
    if (!startSkill) startSkill = 'addsub';
    return { startSubject: subj || 'math', startSkill: startSkill, startModule: SKILL_TO_MODULE[startSkill] };
  }

  // ---------- answer checking ----------
  function parseDecimal(s) {
    if (s === null || s === undefined) return null;
    s = String(s).trim().replace(/[$,\s]/g, '');
    if (!/^\d*\.?\d+$/.test(s) && !/^\d+\.$/.test(s)) return null;
    return parseFloat(s);
  }
  function normText(s) { return String(s == null ? '' : s).trim().toLowerCase().replace(/[.!?"]/g, '').replace(/\s+/g, ' '); }
  // returns {correct, almost, invalid, message}
  function checkAnswer(q, input) {
    if (q.answerType === 'number') {
      var v = parseNumber(input);
      if (v === null) return { correct: false, invalid: true, message: 'Type a whole number (like 48).' };
      return { correct: v === q.answer };
    }
    if (q.answerType === 'decimal') {
      var dv = parseDecimal(input);
      if (dv === null) return { correct: false, invalid: true, message: 'Type a number like 4.75 (you can leave off the $).' };
      return { correct: Math.round(dv * 1000) === Math.round(q.answer * 1000) };
    }
    if (q.answerType === 'text') {
      var t = normText(input);
      if (!t) return { correct: false, invalid: true, message: 'Type the word first.' };
      return { correct: t === normText(q.answer) };
    }
    if (q.answerType === 'choice') {
      return { correct: String(input) === String(q.answer) };
    }
    if (q.answerType === 'shade') {
      var count = typeof input === 'number' ? input : parseNumber(input);
      if (count === null) return { correct: false, invalid: true, message: 'Click some parts of the bar first.' };
      return { correct: count === q.answer };
    }
    if (q.answerType === 'fraction') {
      var f = parseFraction(input);
      if (!f) return { correct: false, invalid: true, message: 'Fill in the top and bottom numbers (like 3 over 4).' };
      var ans = q.answer;
      if (!equalsF(f, ans)) return { correct: false };
      if (q.requireSimplest && !isSimplest(f)) return { correct: false, almost: true, message: 'Almost! ' + fstr(f) + ' is equal, but it can be simplified more. Give it one more try.' };
      return { correct: true };
    }
    return { correct: false };
  }
  function answerText(q) {
    if (q.answerType === 'fraction') return fstr(q.answer);
    if (q.answerType === 'shade') return q.answer + ' of ' + q.shadeD + ' parts shaded (' + q.answer + '/' + q.shadeD + ')';
    if (q.answerType === 'decimal') return q.money ? '$' + (+q.answer).toFixed(2) : fmtDec(q.answer);
    return String(q.answer);
  }

  // ---------- state ----------
  function todayKey(d) { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  var SR_START_EASE = 2.3, SR_MIN_EASE = 1.5, SR_MAX_EASE = 2.8, SR_MAX_DAYS = 30, DAY_MS = 86400000;
  function newSkill() { return { history: [], srInterval: 0, srEase: SR_START_EASE, srReps: 0, srNextDue: null, srLastReviewed: null, level: 1, streakRight: 0, streakWrong: 0, updatedAt: null }; }
  function fixSkill(o) {
    var s = newSkill();
    if (!o || typeof o !== 'object') return s;
    if (Array.isArray(o.history)) s.history = o.history.filter(function (v) { return v === 0 || v === 1; }).slice(-12);
    if (typeof o.srInterval === 'number' && isFinite(o.srInterval) && o.srInterval >= 0) s.srInterval = Math.min(365, o.srInterval);
    if (typeof o.srEase === 'number' && isFinite(o.srEase)) s.srEase = Math.max(SR_MIN_EASE, Math.min(SR_MAX_EASE, o.srEase));
    if (typeof o.srReps === 'number' && isFinite(o.srReps) && o.srReps >= 0) s.srReps = Math.floor(o.srReps);
    if (o.srNextDue && !isNaN(new Date(o.srNextDue))) s.srNextDue = new Date(o.srNextDue).toISOString();
    if (o.srLastReviewed && !isNaN(new Date(o.srLastReviewed))) s.srLastReviewed = new Date(o.srLastReviewed).toISOString();
    if (o.level) s.level = clampLevel(o.level);
    if (typeof o.streakRight === 'number' && o.streakRight >= 0) s.streakRight = Math.floor(o.streakRight);
    if (typeof o.streakWrong === 'number' && o.streakWrong >= 0) s.streakWrong = Math.floor(o.streakWrong);
    if (o.updatedAt && !isNaN(new Date(o.updatedAt))) s.updatedAt = new Date(o.updatedAt).toISOString();
    return s;
  }
  function newState() {
    var s = { version: 3, studentName: '', xp: 0, answerStreak: 0, bestStreak: 0, dayStreak: 0, lastPlayDate: null, missionDoneDate: null, theme: 'all', placement: null, checks: {}, skill: {}, sessions: [], practiceLog: {}, parent: { pinEnabled: false, pin: '0000' }, settingsAt: null, resetAt: null };
    SKILL_ORDER.forEach(function (k) { s.skill[k] = newSkill(); });
    return s;
  }
  function hashStr(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  function sessionId(s) { return 's' + hashStr([s.date, s.mode, s.module, s.kind || '', s.score, s.total, s.minutes].join('|')); }
  function latestCheck(checks) {
    var best = null;
    Object.keys(checks || {}).forEach(function (k) { var c = checks[k]; if (c && (!best || String(c.date) > String(best.date))) best = c; });
    return best;
  }
  function loadState(raw) {
    var s = newState();
    if (!raw) return s;
    try {
      var o = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!o || typeof o !== 'object') return s;
      Object.keys(s).forEach(function (k) { if (o[k] !== undefined && o[k] !== null) s[k] = o[k]; });
      if (!s.skill || typeof s.skill !== 'object') s.skill = {};
      var sk = {};
      SKILL_ORDER.forEach(function (k) { sk[k] = fixSkill(s.skill[k]); });
      s.skill = sk;
      if (!Array.isArray(s.sessions)) s.sessions = [];
      s.sessions = s.sessions.filter(function (x) { return x && typeof x === 'object'; });
      s.sessions.forEach(function (x) { if (!x.id) x.id = sessionId(x); });
      if (!s.practiceLog || typeof s.practiceLog !== 'object') s.practiceLog = {};
      if (!s.checks || typeof s.checks !== 'object') s.checks = {};
      // Older math-only version: its 10-question placement becomes the Math-Only Check.
      if (s.placement && !Object.keys(s.checks).length) {
        s.placement.kind = s.placement.kind || 'math';
        s.placement.total = s.placement.total || 10;
        s.checks[s.placement.kind] = s.placement;
      }
      Object.keys(s.checks).forEach(function (k) {
        var c = s.checks[k];
        if (!c || typeof c !== 'object') { delete s.checks[k]; return; }
        c.kind = c.kind || k;
        if (!c.startModule && c.perArea) { var r = startFrom(c.perArea, c.perSubject || {}); c.startModule = r.startModule; c.startSubject = r.startSubject; }
      });
      if (Object.keys(s.checks).length) s.placement = latestCheck(s.checks);
      if (!s.parent || typeof s.parent !== 'object') s.parent = { pinEnabled: false, pin: '0000' };
      if (!/^\d{4}$/.test(String(s.parent.pin))) s.parent.pin = '0000';
      s.parent.pinEnabled = !!s.parent.pinEnabled;
      if (typeof s.xp !== 'number' || isNaN(s.xp)) s.xp = 0;
      ['answerStreak', 'bestStreak', 'dayStreak'].forEach(function (k) { if (typeof s[k] !== 'number' || isNaN(s[k])) s[k] = 0; });
      if (typeof s.studentName !== 'string') s.studentName = '';
      if (typeof s.theme !== 'string' || (s.theme !== 'all' && !THEMES[s.theme])) s.theme = 'all';
      s.version = 3;
      return s;
    } catch (e) { return newState(); }
  }

  function xpForAnswer(correct, usedHint, streak) {
    if (!correct) return 2; // effort points, never zero
    var x = usedHint ? 6 : 10;
    if (streak >= 3) x += 2;
    if (streak >= 5) x += 3;
    return x;
  }
  function addDays(now, days) { return new Date(now.getTime() + days * DAY_MS).toISOString(); }
  // Spaced repetition for one skill. Misses come right back; clean passes wait 1, 3, 7 days, then keep growing.
  function scheduleReview(sk, correct, usedHint, now) {
    if (!correct) {
      sk.srReps = 0; sk.srInterval = 0;
      sk.srEase = Math.max(SR_MIN_EASE, +(sk.srEase - 0.2).toFixed(2));
      sk.srNextDue = now.toISOString();
    } else if (usedHint) {
      sk.srReps = Math.max(1, sk.srReps);
      sk.srInterval = Math.max(1, Math.round(sk.srInterval || 1));
      sk.srNextDue = addDays(now, sk.srInterval);
    } else {
      sk.srReps += 1;
      sk.srInterval = sk.srReps === 1 ? 1 : sk.srReps === 2 ? 3 : sk.srReps === 3 ? 7 : Math.min(SR_MAX_DAYS, Math.round(sk.srInterval * sk.srEase));
      sk.srEase = Math.min(SR_MAX_EASE, +(sk.srEase + 0.05).toFixed(2));
      sk.srNextDue = addDays(now, sk.srInterval);
    }
    sk.srLastReviewed = now.toISOString();
  }
  // Adaptive difficulty for one skill. 3 clean passes in a row step up (2 if the skill is already Solid); 2 misses step down.
  function adaptLevel(sk, correct, usedHint, solid) {
    var from = sk.level;
    if (correct && !usedHint) {
      sk.streakRight += 1; sk.streakWrong = 0;
      if (sk.streakRight >= (solid ? 2 : 3)) { if (sk.level < 3) sk.level += 1; sk.streakRight = 0; }
    } else if (correct) {
      sk.streakWrong = 0; sk.streakRight = 0; // a hinted pass holds the level and restarts the clean streak
    } else {
      sk.streakWrong += 1; sk.streakRight = 0;
      if (sk.streakWrong >= 2) { if (sk.level > 1) sk.level -= 1; sk.streakWrong = 0; }
    }
    return { from: from, to: sk.level };
  }
  // mutates state; returns { xp, levelFrom, levelTo, skill }
  function recordAnswerDetailed(state, q, correct, usedHint, now) {
    now = now || new Date();
    if (correct) { state.answerStreak += 1; state.bestStreak = Math.max(state.bestStreak, state.answerStreak); }
    else state.answerStreak = 0;
    var gained = xpForAnswer(correct, usedHint, state.answerStreak);
    state.xp += gained;
    var out = { xp: gained, levelFrom: null, levelTo: null, skill: q.skill || null };
    if (q.skill && state.skill[q.skill]) {
      var sk = state.skill[q.skill] = fixSkill(state.skill[q.skill]);
      var st = statusFrom(sk.history.reduce(function (a, v) { return a + v; }, 0), sk.history.length);
      var solid = sk.history.length >= 6 && st.key === 'solid';
      sk.history.push(correct ? 1 : 0);
      while (sk.history.length > 12) sk.history.shift();
      scheduleReview(sk, correct, usedHint, now);
      var lv = adaptLevel(sk, correct, usedHint, solid);
      out.levelFrom = lv.from; out.levelTo = lv.to;
      sk.updatedAt = now.toISOString();
    }
    return out;
  }
  function recordAnswer(state, q, correct, usedHint, now) { return recordAnswerDetailed(state, q, correct, usedHint, now).xp; }
  function daysBetween(a, b) {
    var pa = a.split('-').map(Number), pb = b.split('-').map(Number);
    return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
  }
  function recordSession(state, session, now) {
    now = now || new Date();
    var tk = todayKey(now);
    if (!state.lastPlayDate) state.dayStreak = 1;
    else {
      var gap = daysBetween(state.lastPlayDate, tk);
      if (gap === 1) state.dayStreak += 1; else if (gap > 1) state.dayStreak = 1; else if (!state.dayStreak) state.dayStreak = 1;
    }
    state.lastPlayDate = tk;
    if (session.mode === 'mission') state.missionDoneDate = tk;
    session.date = session.date || now.toISOString();
    session.minutes = Math.max(1, Math.min(60, Math.round(session.minutes || 1)));
    if (!Array.isArray(session.subjects)) { var m = moduleById(session.module); session.subjects = m ? [m.subject] : []; }
    if (!session.id) session.id = 's' + now.getTime().toString(36) + Math.floor(Math.random() * 1679616).toString(36);
    state.sessions.unshift(session);
    while (state.sessions.length > 60) state.sessions.pop();
    if (!state.practiceLog) state.practiceLog = {};
    var day = state.practiceLog[tk] || (state.practiceLog[tk] = { sessions: 0, minutes: 0, subjects: {} });
    day.sessions += 1; day.minutes += session.minutes;
    session.subjects.forEach(function (sb) { day.subjects[sb] = (day.subjects[sb] || 0) + 1; });
    return state;
  }
  function applyPlacement(state, results, kind, now) {
    if (kind instanceof Date) { now = kind; kind = null; }
    kind = kind || 'full'; now = now || new Date();
    var r = scorePlacement(results, kind);
    var rec = { kind: kind, date: now.toISOString(), score: r.score, total: r.total, belt: r.belt, perArea: r.perArea, perSubject: r.perSubject, startModule: r.startModule, startSubject: r.startSubject, results: results };
    if (!state.checks) state.checks = {};
    state.checks[kind] = rec;
    state.placement = rec;
    var b = beltByName(r.belt);
    if (state.xp < b.xp) state.xp = b.xp;
    // Seed each skill's level: a perfect score on it starts at Level 2 (or keeps a higher level); a miss sets Level 1.
    Object.keys(r.perArea).forEach(function (k) {
      var pa = r.perArea[k], sk = state.skill[k];
      if (!pa.total || !sk) return;
      if (pa.correct === pa.total) { if (sk.level < 2) { sk.level = 2; sk.updatedAt = now.toISOString(); } }
      else if (sk.level !== 1) { sk.level = 1; sk.streakRight = 0; sk.updatedAt = now.toISOString(); }
    });
    return r;
  }
  function hasAnyCheck(state) { return !!(state.checks && Object.keys(state.checks).length); }

  function placementArea(state, skill) {
    var right = 0, total = 0;
    var checks = state.checks || {};
    Object.keys(checks).forEach(function (k) {
      var pa = checks[k] && checks[k].perArea && checks[k].perArea[skill];
      if (pa) { right += pa.correct; total += pa.total; }
    });
    return { right: right, total: total };
  }
  function statusFrom(right, total) {
    if (!total) return { key: 'none', label: 'Not checked yet', right: 0, total: 0, pct: null };
    var pct = right / total;
    var key = pct >= 0.8 ? 'solid' : pct >= 0.5 ? 'working' : 'focus';
    return { key: key, label: { solid: 'Solid', working: 'Working On It', focus: 'Needs Focus First' }[key], right: right, total: total, pct: pct };
  }
  function skillStatus(state, skill) {
    var p = placementArea(state, skill), right = p.right, total = p.total;
    var h = (state.skill[skill] && state.skill[skill].history) || [];
    // Once there is real practice, recent practice matters more than the placement check.
    if (h.length >= 6) { right = 0; total = 0; }
    h.forEach(function (v) { right += v; total += 1; });
    return statusFrom(right, total);
  }
  function subjectStatus(state, subject) {
    var right = 0, total = 0, hr = 0, ht = 0;
    skillsFor(subject).forEach(function (k) {
      var p = placementArea(state, k); right += p.right; total += p.total;
      ((state.skill[k] && state.skill[k].history) || []).forEach(function (v) { hr += v; ht += 1; });
    });
    if (ht >= 6) return statusFrom(hr, ht);
    return statusFrom(right + hr, total + ht);
  }
  function allStatuses(state) { var o = {}; SKILL_ORDER.forEach(function (k) { o[k] = skillStatus(state, k); }); return o; }
  function allSubjectStatuses(state) { var o = {}; SUBJECT_ORDER.forEach(function (k) { o[k] = subjectStatus(state, k); }); return o; }

  // ---------- spaced repetition helpers ----------
  function isDue(state, skill, now) {
    var s = state.skill && state.skill[skill];
    return !!(s && s.srNextDue && new Date(s.srNextDue).getTime() <= (now || new Date()).getTime());
  }
  // Skills that are due for review now, most overdue first.
  function dueSkills(state, now) {
    now = now || new Date();
    return SKILL_ORDER.filter(function (k) { return isDue(state, k, now); }).sort(function (a, b) {
      return new Date(state.skill[a].srNextDue) - new Date(state.skill[b].srNextDue) || SKILL_ORDER.indexOf(a) - SKILL_ORDER.indexOf(b);
    });
  }
  // Plain-English review note for one skill.
  function reviewInfo(state, skill, now) {
    now = now || new Date();
    var s = state.skill && state.skill[skill];
    if (!s || !s.srNextDue) return { key: 'new', due: false, days: null, text: 'No review scheduled yet' };
    var ms = new Date(s.srNextDue).getTime() - now.getTime();
    if (ms <= 0) return { key: 'due', due: true, days: 0, text: 'Due for review today' };
    var days = daysBetween(todayKey(now), todayKey(new Date(s.srNextDue)));
    if (days <= 0) return { key: 'today', due: false, days: 0, text: 'Review later today' };
    return { key: 'later', due: false, days: days, text: 'Next review in ' + days + ' day' + (days === 1 ? '' : 's') };
  }
  function levelLabel(l) { return LEVELS[clampLevel(l)].badge; }

  function himName(state) { return state.studentName ? state.studentName : 'him'; }
  var LEVEL_RANK = { focus: 0, working: 1, none: 2, solid: 3 };
  var DUE_BOOST = 0.15; // a subject with skills due for review moves up the line
  function subjectDueCount(state, subject, now) { return skillsFor(subject).filter(function (k) { return isDue(state, k, now); }).length; }
  function rankSubjects(state, rng, now) {
    now = now || new Date();
    var st = allSubjectStatuses(state), tie = {};
    SUBJECT_ORDER.forEach(function (s, i) { tie[s] = rng ? rng() : i / 100; });
    function score(s) { return (st[s].pct === null ? 0.6 : st[s].pct) - (subjectDueCount(state, s, now) ? DUE_BOOST : 0); }
    return SUBJECT_ORDER.slice().sort(function (a, b) {
      var pa = score(a), pb = score(b);
      if (Math.abs(pa - pb) > 1e-9) return pa - pb;
      return tie[a] - tie[b];
    });
  }
  function weakestSkill(state, subject, now) {
    now = now || new Date();
    var best = null, bestKey = 99;
    skillsFor(subject).forEach(function (k) {
      var s = skillStatus(state, k), key = LEVEL_RANK[s.key] + (s.pct === null ? 0.5 : s.pct) / 10 - (isDue(state, k, now) ? 1 : 0);
      if (key < bestKey - 1e-9) { bestKey = key; best = k; }
    });
    return best;
  }
  function skillNames(list) {
    var names = list.map(function (k) { return SKILLS[k].label; });
    if (names.length <= 1) return names.join('');
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }
  function recommendNext(state, now) {
    now = now || new Date();
    var nm = himName(state);
    if (!hasAnyCheck(state)) return { module: null, placement: true, due: [], text: 'Have ' + nm + ' take the Full Placement Check first (about 10 minutes, or split it into shorter checks). It shows where he stands in all 7 subjects.' };
    var st = allSubjectStatuses(state), due = dueSkills(state, now);
    var dueNote = due.length ? ' Due for review today: ' + skillNames(due.slice(0, 3)) + (due.length > 3 ? ' (plus ' + (due.length - 3) + ' more)' : '') + '. The Daily Mission mixes these in.' : '';
    var order = SUBJECT_ORDER.slice().sort(function (a, b) {
      var la = LEVEL_RANK[st[a].key], lb = LEVEL_RANK[st[b].key];
      if (la !== lb) return la - lb;
      var pa = st[a].pct === null ? 0.6 : st[a].pct, pb = st[b].pct === null ? 0.6 : st[b].pct;
      if (Math.abs(pa - pb) > 1e-9) return pa - pb;
      return SUBJECT_ORDER.indexOf(a) - SUBJECT_ORDER.indexOf(b);
    });
    var missionDone = state.missionDoneDate === todayKey(now);
    var target = order[0];
    if (st[target].key === 'solid') {
      if (due.length) {
        var dm = moduleById(SKILL_TO_MODULE[due[0]]);
        return { module: dm.id, subject: dm.subject, due: due, text: 'Everything looks solid. Have ' + nm + ' do Today\'s Daily Mission' + (missionDone ? ' again tomorrow' : '') + ' and 1 review round of "' + dm.title + '" (' + subjectById(dm.subject).label + ') so it sticks.' + dueNote };
      }
      return { module: 'gameday', subject: 'math', due: due, text: 'Everything looks solid. Have ' + nm + ' do Today\'s Daily Mission' + (missionDone ? ' again tomorrow' : '') + ' and a round of "Story Missions" to keep it sharp.' };
    }
    var m1 = moduleById(SKILL_TO_MODULE[weakestSkill(state, target, now)]);
    var second = target !== 'math' && st.math.key !== 'solid' ? 'math' : order[1];
    var m2 = moduleById(SKILL_TO_MODULE[weakestSkill(state, second, now)]);
    if (due.length) { var dmod = moduleById(SKILL_TO_MODULE[due[0]]); if (dmod.id !== m1.id) m2 = dmod; }
    if (m2.id === m1.id) m2 = moduleById(second === 'math' ? 'gameday' : modulesFor(second)[1] ? modulesFor(second)[1].id : 'reading');
    var why = st[target].key === 'focus' ? subjectById(target).label + ' needs the most help right now.' : st[target].key === 'working' ? 'He is getting ' + subjectById(target).label + ', and a little more practice will lock it in.' : 'He has not tried ' + subjectById(target).label + ' yet.';
    var start = missionDone ? 'Today\'s Daily Mission is done. Next, have ' + nm + ' play ' : 'Have ' + nm + ' do Today\'s Daily Mission (about 10 minutes), then ';
    return { module: m1.id, module2: m2.id, subject: target, due: due, text: start + '1 short round of "' + m1.title + '" (' + subjectById(m1.subject).label + ') and 1 round of "' + m2.title + '" (' + subjectById(m2.subject).label + '). ' + why + dueNote };
  }

  // Weakest subjects first, skills due for review mixed in, each question at his level for that skill.
  function generateMission(state, theme, rng, count, now) {
    rng = rng || Math.random; count = count === 7 ? 7 : 5; now = now || new Date();
    var ranked = rankSubjects(state, rng, now), due = dueSkills(state, now);
    var plan = count === 7 ? [ranked[0], ranked[0], ranked[1], ranked[1], ranked[2], ranked[3], ranked[4]] : [ranked[0], ranked[0], ranked[1], ranked[2], ranked[3]];
    var seen = {}, used = {}, skills = [];
    plan.forEach(function (subj) {
      var sk;
      if (!seen[subj]) sk = weakestSkill(state, subj, now);
      else {
        var dueHere = due.filter(function (k) { return SKILLS[k].subject === subj && !used[k]; });
        sk = dueHere.length ? dueHere[0] : pick(rng, skillsFor(subj));
      }
      seen[subj] = true; used[sk] = (used[sk] || 0) + 1; skills.push(sk);
    });
    // Make sure the most overdue review skill gets a spot, even if its subject is strong.
    var missing = due.filter(function (k) { return !used[k]; });
    var needed = Math.min(due.length, count === 7 ? 2 : 1), slot = skills.length - 1;
    while (missing.length && slot >= 2 && skills.filter(function (k) { return isDue(state, k, now); }).length < needed) {
      if (!isDue(state, skills[slot], now)) skills[slot] = missing.shift();
      slot -= 1;
    }
    var prompts = {};
    var out = skills.map(function (sk, i) {
      var mod = SKILL_TO_MODULE[sk];
      if (sk === 'equiv' && rng() < 0.5) mod = 'compare';
      var q, tries = 0;
      do { q = generateQuestion(mod, theme, rng, Math.min(i + 1, 4), skillLevel(state, sk)); tries++; } while (prompts[q.prompt] && tries < 15);
      prompts[q.prompt] = true; q.step = i; q.review = isDue(state, sk, now); return q;
    });
    out.dueCount = out.filter(function (q) { return q.review; }).length;
    return out;
  }

  // ---------- Family Code + cloud sync helpers (pure) ----------
  var CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I, so it is easy to read aloud and type
  function makeSyncCode(randomBytes) {
    var bytes = randomBytes(8), out = '';
    for (var i = 0; i < 8; i++) out += CODE_ALPHABET[bytes[i] % 32];
    return out.slice(0, 4) + '-' + out.slice(4);
  }
  function normalizeSyncCode(s) {
    if (s === null || s === undefined) return null;
    var c = String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(c)) return null;
    return c.slice(0, 4) + '-' + c.slice(4);
  }
  function isoMax(a, b) { if (!a) return b || null; if (!b) return a; return new Date(a) >= new Date(b) ? a : b; }
  function dayMax(a, b) { if (!a) return b || null; if (!b) return a; return a >= b ? a : b; }
  function after(iso, cut) { return !cut || (!!iso && new Date(iso) >= new Date(cut)); }
  // Combine two copies of the same profile (this browser and the cloud) without losing anything newer on either side.
  function mergeStates(localRaw, remoteRaw) {
    var a = loadState(localRaw), b = loadState(remoteRaw), out = newState();
    // A Reset (or a restored backup) stamps resetAt. The copy with the newest stamp is the base; from an older copy
    // we only keep things that happened after that stamp.
    var cut = isoMax(a.resetAt, b.resetAt);
    var aOld = !!cut && (!a.resetAt || new Date(a.resetAt) < new Date(cut)), bOld = !!cut && (!b.resetAt || new Date(b.resetAt) < new Date(cut));
    function keepA(iso) { return !aOld || after(iso, cut); }
    function keepB(iso) { return !bOld || after(iso, cut); }
    out.resetAt = cut;
    var setA = a.settingsAt ? new Date(a.settingsAt).getTime() : -1, setB = b.settingsAt ? new Date(b.settingsAt).getTime() : -1;
    var sset = setB > setA ? b : a;
    out.studentName = sset.studentName; out.theme = sset.theme; out.parent = { pinEnabled: !!sset.parent.pinEnabled, pin: sset.parent.pin }; out.settingsAt = isoMax(a.settingsAt, b.settingsAt);
    var cand = [aOld ? null : a, bOld ? null : b].filter(Boolean);
    out.xp = Math.max.apply(null, cand.map(function (x) { return x.xp; }));
    out.bestStreak = Math.max.apply(null, cand.map(function (x) { return x.bestStreak; }));
    var lastP = cand.reduce(function (m, x) { return dayMax(m, x.lastPlayDate); }, null);
    out.lastPlayDate = lastP;
    out.dayStreak = Math.max.apply(null, cand.filter(function (x) { return x.lastPlayDate === lastP; }).map(function (x) { return x.dayStreak; }).concat([0]));
    out.missionDoneDate = cand.reduce(function (m, x) { return dayMax(m, x.missionDoneDate); }, null);
    out.answerStreak = cand.slice().sort(function (x, y) { return latestActivity(y) - latestActivity(x); })[0].answerStreak;
    SKILL_ORDER.forEach(function (k) {
      var sa = a.skill[k], sb = b.skill[k];
      var okA = aOld ? !!sa.updatedAt && after(sa.updatedAt, cut) : true, okB = bOld ? !!sb.updatedAt && after(sb.updatedAt, cut) : true;
      var pickS = !okA ? sb : !okB ? sa : (new Date(sb.updatedAt || 0) > new Date(sa.updatedAt || 0) ? sb : sa);
      out.skill[k] = (!okA && !okB) ? newSkill() : fixSkill(pickS);
    });
    PLACEMENT_KINDS.forEach(function (k) {
      var ca = a.checks[k], cb = b.checks[k];
      if (ca && !keepA(ca.date)) ca = null;
      if (cb && !keepB(cb.date)) cb = null;
      var c = ca && cb ? (new Date(cb.date) > new Date(ca.date) ? cb : ca) : (ca || cb);
      if (c) out.checks[k] = c;
    });
    out.placement = latestCheck(out.checks);
    var byId = {};
    a.sessions.forEach(function (x) { if (x.id && keepA(x.date) && !byId[x.id]) byId[x.id] = x; });
    b.sessions.forEach(function (x) { if (x.id && keepB(x.date) && !byId[x.id]) byId[x.id] = x; });
    out.sessions = Object.keys(byId).map(function (id) { return byId[id]; }).sort(function (x, y) { return new Date(y.date) - new Date(x.date); }).slice(0, 60);
    var cutDay = cut ? todayKey(new Date(cut)) : null, days = {}, derived = {};
    function logOf(x, old, dk) { var d = x.practiceLog[dk]; return d && (!old || dk >= cutDay) ? d : null; }
    [a, b].forEach(function (x) { Object.keys(x.practiceLog || {}).forEach(function (d) { days[d] = true; }); });
    out.sessions.forEach(function (x) {
      var dk = todayKey(new Date(x.date)), d = derived[dk] || (derived[dk] = { sessions: 0, minutes: 0, subjects: {} });
      d.sessions += 1; d.minutes += x.minutes || 0; (x.subjects || []).forEach(function (sb) { d.subjects[sb] = (d.subjects[sb] || 0) + 1; });
      days[dk] = true;
    });
    Object.keys(days).forEach(function (dk) {
      var opts = [logOf(a, aOld, dk), logOf(b, bOld, dk), derived[dk]].filter(Boolean);
      if (!opts.length) return;
      var best = opts.slice().sort(function (x, y) { return (y.sessions || 0) - (x.sessions || 0) || (y.minutes || 0) - (x.minutes || 0); })[0];
      out.practiceLog[dk] = { sessions: best.sessions || 0, minutes: Math.max.apply(null, opts.map(function (o) { return o.minutes || 0; })), subjects: JSON.parse(JSON.stringify(best.subjects || {})) };
    });
    return out;
  }
  function latestActivity(s) {
    var t = 0;
    (s.sessions || []).forEach(function (x) { var v = new Date(x.date).getTime(); if (v > t) t = v; });
    SKILL_ORDER.forEach(function (k) { var u = s.skill[k] && s.skill[k].updatedAt; if (u) { var v = new Date(u).getTime(); if (v > t) t = v; } });
    return t;
  }
  // True when two copies hold the same progress (ignores order and derived fields).
  function sameProgress(x, y) {
    function sig(s) { s = loadState(s); return JSON.stringify([s.studentName, s.theme, s.xp, s.answerStreak, s.bestStreak, s.dayStreak, s.lastPlayDate, s.missionDoneDate, s.parent, s.settingsAt, s.resetAt, s.skill, PLACEMENT_KINDS.map(function (k) { var c = s.checks[k]; return c ? [c.date, c.score] : null; }), s.sessions.map(function (z) { return z.id; }), s.practiceLog]); }
    return sig(x) === sig(y);
  }
  function hasProgress(s) {
    s = loadState(s);
    return !!(s.xp || s.sessions.length || hasAnyCheck(s) || s.studentName || SKILL_ORDER.some(function (k) { return s.skill[k].history.length; }));
  }

  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return String(iso);
    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var h = d.getHours(), ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
    return days[d.getDay()] + ', ' + mons[d.getMonth()] + ' ' + d.getDate() + ', ' + h + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + ap;
  }
  function fmtDay(key) {
    var p = key.split('-').map(Number), d = new Date(p[0], p[1] - 1, p[2]);
    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return days[d.getDay()] + ', ' + mons[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }
  function sessionTitle(s) {
    if (s.mode === 'placement') return (PLACEMENT_INFO[s.kind || 'math'] || PLACEMENT_INFO.math).label;
    if (s.mode === 'mission') return 'Daily Mission';
    var m = moduleById(s.module); return m ? subjectById(m.subject).label + ': ' + m.title : s.module;
  }
  function practiceTotals(state, now) {
    now = now || new Date();
    var log = state.practiceLog || {}, days = Object.keys(log).sort();
    var t = { days: days.length, sessions: 0, minutes: 0, subjectDays: {}, subjectSessions: {}, last7Minutes: 0, last7Days: 0, firstDay: days[0] || null, dayList: days };
    SUBJECT_ORDER.forEach(function (s) { t.subjectDays[s] = 0; t.subjectSessions[s] = 0; });
    var today = todayKey(now);
    days.forEach(function (k) {
      var d = log[k]; t.sessions += d.sessions || 0; t.minutes += d.minutes || 0;
      Object.keys(d.subjects || {}).forEach(function (s) { if (t.subjectDays[s] !== undefined) { t.subjectDays[s] += 1; t.subjectSessions[s] += d.subjects[s]; } });
      var gap = daysBetween(k, today);
      if (gap >= 0 && gap < 7) { t.last7Minutes += d.minutes || 0; t.last7Days += 1; }
    });
    return t;
  }

  function buildSummaryText(state, now) {
    now = now || new Date();
    var name = state.studentName || 'Your son';
    var belt = beltForXp(state.xp), st = allSubjectStatuses(state), sk = allStatuses(state), tot = practiceTotals(state, now);
    var lines = [];
    lines.push('Dispatch Academy: progress report for ' + name);
    lines.push('Date: ' + fmtDate(now.toISOString()));
    lines.push('Rank: ' + belt.name + '  |  XP: ' + state.xp + '  |  Days in a row: ' + (state.dayStreak || 0));
    var anyCheck = false;
    PLACEMENT_KINDS.forEach(function (k) {
      var c = state.checks && state.checks[k];
      if (c) { anyCheck = true; lines.push(PLACEMENT_INFO[k].label + ': ' + c.score + ' out of ' + c.total + ' (' + fmtDate(c.date) + ')'); }
    });
    if (!anyCheck) lines.push('Placement Check: not taken yet');
    lines.push('');
    lines.push('WHERE HE STANDS (ALL 7 SUBJECTS)');
    SUBJECT_ORDER.forEach(function (s) {
      var x = st[s];
      lines.push('- ' + subjectById(s).label + ': ' + x.label + (x.total ? ' (' + x.right + ' of ' + x.total + ' right)' : ''));
    });
    lines.push('');
    lines.push('MATH DETAILS');
    skillsFor('math').forEach(function (k) { var x = sk[k]; lines.push('- ' + SKILLS[k].dad + ': ' + x.label + (x.total ? ' (' + x.right + ' of ' + x.total + ')' : '')); });
    lines.push('');
    lines.push('LEVELS AND REVIEWS');
    lines.push('Each skill has a level (1 = Starter, 2 = 5th Grade, 3 = Challenge) that moves up after 3 clean answers in a row and down after 2 misses in a row.');
    var due = dueSkills(state, now);
    lines.push(due.length ? 'Due for review today: ' + skillNames(due) + '.' : 'Nothing is due for review today.');
    SKILL_ORDER.forEach(function (k) {
      var sk2 = state.skill[k];
      if (!sk2 || (!sk2.history.length && sk2.level === 1 && !sk2.srNextDue)) return;
      lines.push('- ' + SKILLS[k].label + ': ' + levelLabel(sk2.level) + ', ' + reviewInfo(state, k, now).text.toLowerCase());
    });
    lines.push('');
    lines.push('NEXT STEP');
    lines.push(recommendNext(state, now).text);
    lines.push('');
    lines.push('TEXAS HOMESCHOOL CHECKLIST');
    lines.push('Texas requires reading, spelling, grammar, math, and good citizenship. Science and social studies round out full 5th grade.');
    SUBJECTS.forEach(function (s) {
      lines.push('- ' + s.label + (s.texas ? ' (Texas required)' : ' (full 5th grade)') + ': practiced on ' + tot.subjectDays[s.id] + ' day' + (tot.subjectDays[s.id] === 1 ? '' : 's'));
    });
    lines.push('');
    lines.push('PRACTICE LOG');
    lines.push('Days practiced: ' + tot.days + '  |  Sessions: ' + tot.sessions + '  |  Total minutes: ' + tot.minutes + '  |  Last 7 days: ' + tot.last7Minutes + ' minutes');
    tot.dayList.slice(-10).reverse().forEach(function (k) {
      var d = state.practiceLog[k];
      var subs = Object.keys(d.subjects || {}).map(function (s) { return subjectById(s) ? subjectById(s).label : s; }).join(', ');
      lines.push('- ' + fmtDay(k) + ': ' + d.sessions + ' session' + (d.sessions === 1 ? '' : 's') + ', ' + d.minutes + ' minutes' + (subs ? ' (' + subs + ')' : ''));
    });
    lines.push('');
    lines.push('RECENT SESSIONS');
    if (!state.sessions.length) lines.push('- None yet.');
    state.sessions.slice(0, 6).forEach(function (s) {
      lines.push('- ' + fmtDate(s.date) + ': ' + sessionTitle(s) + ', ' + s.score + ' of ' + s.total + ' right' + (s.minutes ? ', ' + s.minutes + ' min' : '') + (s.hints ? ', used ' + s.hints + ' hint' + (s.hints === 1 ? '' : 's') : ''));
      (s.missed || []).slice(0, 3).forEach(function (m) {
        lines.push('    Missed: ' + m.prompt + ' (He said: ' + (m.given || 'not sure yet') + '. Answer: ' + m.answer + '.)' + (m.note ? ' Tip: ' + m.note : ''));
      });
    });
    return lines.join('\n');
  }

  function sampleState(now) {
    now = now || new Date();
    var s = newState();
    var day = 86400000, t = now.getTime();
    function per(c, n) { return { correct: c, total: n }; }
    s.checks.full = { kind: 'full', date: new Date(t - 4 * day).toISOString(), score: 8, total: 16, belt: 'Yellow', startModule: 'addsub', startSubject: 'grammar', results: [],
      perArea: { ops: per(1, 1), fracIntro: per(1, 1), addsub: per(0, 1), decimals: per(0, 1), readComp: per(1, 1), readClues: per(1, 1), spelling: per(0, 1), homophones: per(1, 1), mechanics: per(0, 2), gov: per(1, 1), citizen: per(1, 1), matter: per(0, 1), earth: per(1, 1), early: per(0, 1), geo: per(0, 1) },
      perSubject: { math: per(2, 4), reading: per(2, 2), spelling: per(1, 2), grammar: per(0, 2), citizenship: per(2, 2), science: per(1, 2), social: per(0, 2) } };
    s.placement = s.checks.full;
    s.xp = 238; s.dayStreak = 3; s.bestStreak = 6; s.lastPlayDate = todayKey(now);
    s.skill.ops.history = [1, 1, 1, 1, 0, 1, 1, 1];
    s.skill.fracIntro.history = [1, 0, 1, 1, 1, 1, 0, 1];
    s.skill.equiv.history = [0, 1, 0, 1, 1, 0, 1];
    s.skill.addsub.history = [0, 0, 1, 0];
    s.skill.readComp.history = [1, 1, 0, 1, 1];
    s.skill.mechanics.history = [0, 1, 0];
    s.skill.homophones.history = [1, 1, 0, 1];
    s.skill.matter.history = [1, 0, 1];
    function sr(k, level, reps, interval, dueInDays) { var x = s.skill[k]; x.level = level; x.srReps = reps; x.srInterval = interval; x.srNextDue = new Date(t + dueInDays * day).toISOString(); x.srLastReviewed = new Date(t - 3600000).toISOString(); x.updatedAt = x.srLastReviewed; }
    sr('ops', 3, 4, 16, 9); sr('fracIntro', 2, 2, 3, 2); sr('equiv', 2, 0, 0, -0.05); sr('addsub', 1, 0, 0, -0.1); sr('readComp', 2, 1, 1, 1); sr('mechanics', 1, 0, 0, -0.04); sr('homophones', 2, 3, 7, 5); sr('matter', 1, 0, 0, -1);
    s.sessions = [
      { mode: 'practice', module: 'mechanics', subjects: ['grammar'], theme: 'soccer', score: 1, total: 3, hints: 2, minutes: 4, date: new Date(t - 1 * 3600000).toISOString(), missed: [
        { prompt: 'Which shows that the jerseys belong to more than one player?', given: 'the player\'s jerseys', answer: 'the players\' jerseys', note: 'More than one owner: put the apostrophe after the s.' }] },
      { mode: 'practice', module: 'equiv', subjects: ['math'], theme: 'roblox', score: 3, total: 5, hints: 2, minutes: 6, date: new Date(t - 2 * 3600000).toISOString(), missed: [
        { prompt: 'In a loot split you get 6/8 of the Robux. Write 6/8 in simplest form.', given: '3/8', answer: '3/4', note: 'Divide the top AND bottom by the same number.' },
        { prompt: 'Which fraction is equal to 2/3?', given: '3/4', answer: '4/6', note: 'Adding the same number to top and bottom does not make an equal fraction.' }] },
      { mode: 'mission', module: 'mission', subjects: ['grammar', 'math', 'science', 'spelling'], theme: 'all', score: 4, total: 5, hints: 1, minutes: 8, date: new Date(t - 1 * day).toISOString(), missed: [
        { prompt: 'Is sand mixed with water a mixture or a solution?', given: 'A solution, because the sand dissolved', answer: 'A mixture, because you can still see and separate the sand', note: 'In a solution, one thing dissolves completely.' }] },
      { mode: 'practice', module: 'reading', subjects: ['reading'], theme: 'baseball', score: 4, total: 5, hints: 0, minutes: 7, date: new Date(t - 2 * day).toISOString(), missed: [
        { prompt: 'What does excellent mean?', given: 'Just okay', answer: 'Very, very good', note: 'Use the clues around the word.' }] },
      { mode: 'practice', module: 'addsub', subjects: ['math'], theme: 'soccer', score: 1, total: 4, hints: 3, minutes: 6, date: new Date(t - 3 * day).toISOString(), missed: [
        { prompt: 'You run 1/2 of a mile in warmups and 1/4 of a mile in drills. How far do you run in all?', given: '2/6', answer: '3/4', note: 'Different bottoms: find a matching denominator first.' }] },
      { mode: 'placement', kind: 'full', module: 'placement', subjects: SUBJECT_ORDER.slice(), theme: 'all', score: 8, total: 16, hints: 0, minutes: 11, date: new Date(t - 4 * day).toISOString(), missed: [
        { prompt: 'Which sentence uses commas correctly?', given: 'not sure yet', answer: 'I grabbed wood, stone, and metal.', note: 'Commas go between items in a list.' }] }
    ];
    s.practiceLog = {};
    s.practiceLog[todayKey(new Date(t))] = { sessions: 2, minutes: 10, subjects: { grammar: 1, math: 1 } };
    s.practiceLog[todayKey(new Date(t - day))] = { sessions: 1, minutes: 8, subjects: { grammar: 1, math: 1, science: 1, spelling: 1 } };
    s.practiceLog[todayKey(new Date(t - 2 * day))] = { sessions: 1, minutes: 7, subjects: { reading: 1 } };
    s.practiceLog[todayKey(new Date(t - 3 * day))] = { sessions: 1, minutes: 6, subjects: { math: 1 } };
    var all = {}; SUBJECT_ORDER.forEach(function (k) { all[k] = 1; });
    s.practiceLog[todayKey(new Date(t - 4 * day))] = { sessions: 1, minutes: 11, subjects: all };
    return s;
  }

  return {
    mulberry32: mulberry32, gcd: gcd, lcm: lcm, frac: frac, simplify: simplify, addF: addF, subF: subF, compareF: compareF, equalsF: equalsF, isSimplest: isSimplest, fstr: fstr,
    parseNumber: parseNumber, parseFraction: parseFraction, parseDecimal: parseDecimal, denName: denName, fmtDec: fmtDec,
    THEMES: THEMES, THEME_KEYS: THEME_KEYS, SUBJECTS: SUBJECTS, SUBJECT_ORDER: SUBJECT_ORDER, subjectById: subjectById, SKILLS: SKILLS, SKILL_ORDER: SKILL_ORDER, skillsFor: skillsFor,
    MODULES: MODULES, moduleById: moduleById, modulesFor: modulesFor, SKILL_TO_MODULE: SKILL_TO_MODULE, PASSAGES: PASSAGES, BANK: BANK,
    BELTS: BELTS, beltForXp: beltForXp, beltIndexForXp: beltIndexForXp, nextBelt: nextBelt, beltByName: beltByName, beltForPct: beltForPct,
    generateQuestion: generateQuestion, generateRound: generateRound, generateMission: generateMission,
    PLACEMENT: PLACEMENT, PLACEMENT_SETS: PLACEMENT_SETS, PLACEMENT_INFO: PLACEMENT_INFO, PLACEMENT_KINDS: PLACEMENT_KINDS, scorePlacement: scorePlacement, applyPlacement: applyPlacement, hasAnyCheck: hasAnyCheck,
    checkAnswer: checkAnswer, answerText: answerText,
    newState: newState, loadState: loadState, recordAnswer: recordAnswer, recordSession: recordSession, xpForAnswer: xpForAnswer,
    skillStatus: skillStatus, subjectStatus: subjectStatus, allStatuses: allStatuses, allSubjectStatuses: allSubjectStatuses, weakestSkill: weakestSkill, rankSubjects: rankSubjects,
    recommendNext: recommendNext, buildSummaryText: buildSummaryText, sampleState: sampleState, practiceTotals: practiceTotals,
    todayKey: todayKey, fmtDate: fmtDate, fmtDay: fmtDay, sessionTitle: sessionTitle,
    LEVELS: LEVELS, levelLabel: levelLabel, clampLevel: clampLevel, skillLevel: skillLevel, recordAnswerDetailed: recordAnswerDetailed, newSkill: newSkill,
    dueSkills: dueSkills, isDue: isDue, reviewInfo: reviewInfo, walkthrough: walkthrough,
    makeSyncCode: makeSyncCode, normalizeSyncCode: normalizeSyncCode, mergeStates: mergeStates, sameProgress: sameProgress, hasProgress: hasProgress, latestCheck: latestCheck
  };
});
