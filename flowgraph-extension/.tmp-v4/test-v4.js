const { createDemoFilmProject, allShots } = require('./ui/studio/filmModel.js');
const { continuityChecks, renderPreflightChecks } = require('./ui/studio/productionChecks.js');
const p = createDemoFilmProject();
const shots = allShots(p);
shots[0].dependencies = [shots[1].id];
shots[1].dependencies = [shots[0].id];
shots[0].continuity = { screenDirection: 'LTR', timeOfDay: 'Night', weather: 'Rain' };
shots[1].continuity = { screenDirection: 'RTL', timeOfDay: 'Day', weather: 'Clear' };
shots[0].status = 'APPROVED';
shots[0].selectedTakeId = undefined;
p.timeline = [{ id: 'v1', projectId: p.id, type: 'VIDEO', name: 'V1', clips: [
  { id: 'c1', trackId: 'v1', shotId: shots[0].id, takeId: 'missing-take', startSeconds: 0, durationSeconds: 2 },
  { id: 'c2', trackId: 'v1', shotId: shots[1].id, startSeconds: 3, durationSeconds: 2 },
]}];
const continuity = continuityChecks(p).map(x => x.code);
const preflight = renderPreflightChecks(p).map(x => x.code);
console.log(JSON.stringify({ continuity, preflight }, null, 2));
for (const expected of ['DEPENDENCY_CYCLE','SCREEN_DIRECTION_FLIP','TIME_OF_DAY_CHANGE','WEATHER_CHANGE','APPROVED_WITHOUT_TAKE']) {
  if (!continuity.includes(expected)) throw new Error('Missing continuity check: ' + expected);
}
for (const expected of ['MISSING_TAKE','PICTURE_GAP','CLIP_WITHOUT_TAKE']) {
  if (!preflight.includes(expected)) throw new Error('Missing preflight check: ' + expected);
}
console.log('V4_RULE_ENGINE_PASS');
