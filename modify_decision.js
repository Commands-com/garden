const fs = require('fs');
const path = '/Users/dtannen/Code/commandgarden/site/days/2026-04-27/decision.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));

const newSummary = "Introduces the Spore Tick swarm enemy, arriving in groups that require splash damage to defeat, featured in today's Spore Bloom challenge.";

// Update summaries
data.candidates[0].summary = newSummary;
data.winner.summary = newSummary;

// Add bluesky_post
data.bluesky_post = {
  headline: "Day 21: The Spore Bloom challenge brings our first swarm enemy!",
  body: "Today's update introduces the Spore Tick, a fast-moving swarm enemy that arrives in clusters. Single-target defenders will get overwhelmed quickly—time to bring out your splash damage! Can your roster handle the Spore Bloom board? 🌸💥",
  alt_text: "Top-down view of the Command Garden game board showing a cluster of small Spore Tick enemies advancing towards a Pollen Puff defender plant."
};

// Add bluesky_strategy
data.bluesky_strategy = {
  searchQueries: ["tower defense indie", "pixel art garden game", "new enemy type", "game dev update", "commandgarden"],
  replyTemplates: {
    whatIs: "Command Garden is a daily top-down lane defense game where your roster evolves over time!",
    howDoesItWork: "Spore Ticks arrive in swarms of five! You'll need splash plants like the Pollen Puff or Cottonburr Mortar to handle them efficiently.",
    genericQuestion: "Thanks for checking it out! You can play today's challenge at commandgarden.com"
  },
  hashtagsToUse: ["#indiedev", "#towerdefense", "#pixelart", "#gamedev"],
  maxDailyActions: 15
};

fs.writeFileSync(path, JSON.stringify(data, null, 2));
console.log('Modified decision.json');
