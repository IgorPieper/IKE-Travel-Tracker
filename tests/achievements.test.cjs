const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Exercise the production rendering and notification functions with a small DOM
// and a controlled clock, without touching the user's saved progress.
class Element {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.events = {};
    this.style = { setProperty: (key, value) => { this.style[key] = value; } };
    this.classes = new Set();
    this.classList = { toggle: (name, value) => value ? this.classes.add(name) : this.classes.delete(name) };
  }
  get childElementCount() { return this.children.length; }
  append(...children) {
    for (const child of children) {
      if (child.tagName === 'fragment') { this.append(...child.children); child.children = []; }
      else { this.children.push(child); child.parent = this; }
    }
  }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(name, callback) { this.events[name] = callback; }
  remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
}

function setup() {
  const source = fs.readFileSync(path.join(__dirname, '../web/js/wyzwania.js'), 'utf8');
  const production = source.slice(source.indexOf('  function achievementState('), source.indexOf('  async function showAchievements('));
  const elements = Object.fromEntries(['achievement-cards', 'achievement-summary', 'achievement-notifications'].map(id => [id, new Element('div')]));
  const timers = new Map();
  let timerId = 0;
  const context = vm.createContext({
    document: { createElement: tag => new Element(tag), createDocumentFragment: () => new Element('fragment') },
    byId: id => elements[id], tr: (pl, en) => en,
    setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
    achievementDefinitions: [
      { id: 'countries', rule: 'countries', title: ['Paszport', 'Passport'], icon: '🌍', levels: [10, 25].map(target => ({ target, label: [String(target), String(target)], goal: ['Cel ' + target, 'Visit ' + target], description: ['', ''] })) },
      { id: 'castle', rule: 'castle', title: ['Zamek', 'Castle'], icon: '🏰', levels: [{ target: 1, label: ['', ''], goal: ['Zamek', 'Visit a castle'], description: ['', ''] }] },
      { id: 'secret', rule: 'secret', secret: true, title: ['Sekret', 'Secret'], icon: '★', levels: [{ target: 1, label: ['', ''], goal: ['Sekret', 'Secret goal'], description: ['', ''] }] },
    ],
    developerAllAchievements: false, notificationsEnabled:true,
    metrics: { countries: { count: 10 }, castle: { count: 0 }, secret: { count: 0 } },
    achievementMetric: (rule, metrics) => metrics[rule] || {},
    achievementTiersSeen: new Map(), collapsedAchievementGroups: new Set(),
    achievementToastQueue: [], achievementToastDuration: 6000,
    achievementsView: { hidden: false },
  });
  context.achievementNotificationsEnabled = () => context.notificationsEnabled;
  context.achievementProgress = () => context.metrics;
  vm.runInContext(production, context);
  return { context, elements, timers };
}

test('partial tiers stay in progress; completed group appears only with a full completion', () => {
  const { context: c, elements } = setup();
  c.renderAchievements();
  let groups = elements['achievement-cards'].children;
  assert.equal(groups.length, 1);
  assert.equal(groups[0].dataset.achievementGroup, 'in-progress');
  assert.equal(groups[0].children[1].children.length, 2); // Secret is still hidden.
  c.metrics.castle.count = 1;
  c.renderAchievements();
  groups = elements['achievement-cards'].children;
  assert.deepEqual(groups.map(group => group.dataset.achievementGroup), ['in-progress', 'completed']);
  assert.equal(groups[0].children[1].children[0].dataset.achievement, 'countries');
  assert.equal(groups[1].children[1].children[0].dataset.achievement, 'castle');
  groups[1].open = false;
  groups[1].events.toggle();
  c.renderAchievements();
  assert.equal(elements['achievement-cards'].children[1].open, false);
  c.metrics.castle.count = 0;
  c.renderAchievements();
  assert.equal(elements['achievement-cards'].children.length, 1);
});

test('new tiers notify outside achievements, with a countdown and automatic dismissal', () => {
  const { context: c, elements, timers } = setup();
  c.achievementsView.hidden = true;
  c.renderAchievements();
  assert.equal(elements['achievement-notifications'].children.length, 0); // No startup flood.
  c.metrics.countries.count = 25;
  c.renderAchievements();
  const toast = elements['achievement-notifications'].children[0];
  assert.equal(toast.children[1].children[1].textContent, 'Passport');
  assert.match(toast.children[1].children[2].textContent, /Visit 25/);
  assert.equal(toast.children[3].className, 'achievement-toast-countdown');
  assert.equal(toast.style['--toast-duration'], '6000ms');
  c.renderAchievements();
  assert.equal(elements['achievement-notifications'].children.length, 1);
  const timer = [...timers.values()][0];
  assert.equal(timer.delay, 6000);
  timer.callback();
  assert.equal(elements['achievement-notifications'].children.length, 0);
});

test('unknown metrics never replay old unlocks; secret achievements notify on unlock', () => {
  const { context: c, elements } = setup();
  c.renderAchievements();
  c.metrics.countries.count = undefined;
  c.renderAchievements();
  c.metrics.countries.count = 10;
  c.renderAchievements();
  assert.equal(elements['achievement-notifications'].children.length, 0);
  c.metrics.secret.count = 1;
  c.renderAchievements();
  assert.equal(elements['achievement-notifications'].children.length, 1);
  assert.equal(elements['achievement-cards'].children[1].children[1].children[0].dataset.achievement, 'secret');
  elements['achievement-notifications'].children[0].children[2].events.click();
  assert.equal(elements['achievement-notifications'].children.length, 0);
});


test('notification preference suppresses toasts without hiding unlocks or replaying them later', () => {
  const {context:c,elements}=setup();
  c.renderAchievements();
  c.notificationsEnabled=false;
  c.metrics.countries.count=25;
  c.metrics.secret.count=1;
  c.renderAchievements();
  assert.equal(elements['achievement-notifications'].children.length,0);
  assert.ok(elements['achievement-cards'].children[1].children[1].children.some(card=>card.dataset.achievement==='secret'));
  c.notificationsEnabled=true;
  c.renderAchievements();
  assert.equal(elements['achievement-notifications'].children.length,0);
  c.metrics.castle.count=1;
  c.renderAchievements();
  assert.equal(elements['achievement-notifications'].children.length,1);
  c.notificationsEnabled=false;
  c.showAchievementToasts();
  assert.equal(elements['achievement-notifications'].children.length,0);
  assert.equal(c.achievementToastQueue.length,0);
});
