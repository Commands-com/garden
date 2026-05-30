const fs = require('fs');
const path = 'site/days/2026-05-13/decision.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));

data.headline = "Day 38: Spark Pod Brings Cross-Lane Panic Bursts to Rootline Defense!";
data.summary = "May 13 introduces Spark Pod, a single-use seed-pod that arms in 1.5 seconds and unleashes a cross-lane burst upon enemy contact. This expands roster depth by providing a true panic button for multi-lane crisis waves, whereas Briar Pod remains restricted to its own lane. Board strategy now revolves around identifying synchronized swarm threats and managing tight economy to deploy Spark Pod precisely when two lanes converge. Encounter pressure is significantly heightened by wave 3's synchronized Spore Tick swarm, while the tutorial effectively onboard players to the arming window mechanics. Replayability deepens as players master placement timing, and visual asset quality is maintained with fully hand-authored art. The daily board feels hard-but-winnable without feeling doomed, as the tutorial directly prepares players for the challenge. We verified that the previous dated challenge roster cannot clear today's board without Spark Pod, confirming its load-bearing role in the canonical winning line.";

fs.writeFileSync(path, JSON.stringify(data, null, 2));
console.log('Modified decision.json');
