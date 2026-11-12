import assert from "node:assert/strict";
import { budgetPhrase, groupByRoom, suggestionGroupLabel } from "../src/ui/gamecard.js";

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`ok  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

check("a priced increase shows a plus amount and a drop shows a minus", () => {
  const up = budgetPhrase({ priced: 10, unpriced: 1 }, { priced: 12.5, unpriced: 1 });
  assert.equal(up.text, "+$2.50");
  const down = budgetPhrase({ priced: 12.5, unpriced: 1 }, { priced: 10, unpriced: 1 });
  assert.match(down.text, /−\$2\.50/);
});

check("an unpriced line with the same total says price needed", () => {
  const phrase = budgetPhrase({ priced: 10, unpriced: 2 }, { priced: 10, unpriced: 3 });
  assert.equal(phrase.text, "price needed");
  assert.equal(budgetPhrase({ priced: 10, unpriced: 2 }, { priced: 10, unpriced: 2 }), null);
});

check("suggest preview groups ghosts by room and counts them", () => {
  const groups = groupByRoom([
    { roomId: "living", ghost: true },
    { roomId: "living", ghost: true },
    { roomId: "kitchen", ghost: true },
  ], [
    { id: "living", name: "Living room" },
    { id: "kitchen", name: "Kitchen" },
  ]);
  assert.equal(groups.find((group) => group.id === "living").count, 2);
  assert.equal(groups.find((group) => group.id === "kitchen").name, "Kitchen");
  assert.equal(suggestionGroupLabel(Array.from({ length: 8 }, () => ({ kind: "receptacle" }))), "8 receptacles (outlets)");
  assert.equal(suggestionGroupLabel([{ kind: "kitchen-sink" }]), "1 kitchen sink");
});

if (failed) process.exit(1);
console.log("\ngame card checks passed");
