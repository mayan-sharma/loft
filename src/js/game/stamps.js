// Stamps: the things a flight can earn. Each is a small goal, pressed into
// the journal the first time it is met.
export const STAMPS = [
    { id: "first", name: "First flight", how: "Land anywhere", test: () => true },
    { id: "km1", name: "A thousand", how: "Fly 1,000 m", test: (f) => f.distance >= 1000 },
    { id: "sand", name: "The dunes", how: "Reach the dune country", test: (f) => f.distance >= 2700 },
    { id: "snow", name: "The snows", how: "Reach the snow country", test: (f) => f.distance >= 5300 },
    { id: "round", name: "Three countries", how: "Fly 8,000 m, back to the river", test: (f) => f.distance >= 8000 },
    { id: "string", name: "A full string", how: "Light six lanterns in a row", test: (f) => f.bestCombo >= 6 },
    { id: "lamps", name: "Lamplighter", how: "Light 15 lanterns in one flight", test: (f) => f.lanterns >= 15 },
    { id: "gate", name: "Through the gate", how: "Fly through a gate", test: (f) => f.gates >= 1 },
    { id: "gates", name: "Gatekeeper", how: "Three gates in one flight", test: (f) => f.gates >= 3 },
    { id: "skim", name: "Skimmer", how: "Skim for 10 seconds in one flight", test: (f) => f.skimSeconds >= 10 },
    { id: "night", name: "Night flyer", how: "Be in the air after dark", test: (f) => f.sawNight },
    { id: "dawn", name: "A whole day", how: "Fly from one dawn to the next", test: (f) => f.seconds >= 190 },
]

export const earnedBy = (flight, have) => STAMPS.filter((s) => !have[s.id] && s.test(flight))
