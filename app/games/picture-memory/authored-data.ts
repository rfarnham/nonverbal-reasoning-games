import type { AuthoredRoundSpec, JourneyExtraLevel } from "./round-types.ts";

// Frozen source programs: advanced foils are calculated from the actual study pictures.
// Starter and Junior retain their original upright, generously distinct object sets.
export const AUTHORED_CAMPAIGN_DATA = [
  {
    "id": "campaign:starter:01",
    "difficulty": "Starter",
    "study": [
      "rocket-1"
    ],
    "options": [
      "boat-1",
      "bird-1",
      "rocket-1",
      "boot-1"
    ]
  },
  {
    "id": "campaign:starter:02",
    "difficulty": "Starter",
    "study": [
      "boot-1"
    ],
    "options": [
      "boot-1",
      "bicycle-1",
      "leaf-1",
      "flower-1"
    ]
  },
  {
    "id": "campaign:starter:03",
    "difficulty": "Starter",
    "study": [
      "fish-1"
    ],
    "options": [
      "key-1",
      "mug-1",
      "bicycle-1",
      "fish-1"
    ]
  },
  {
    "id": "campaign:starter:04",
    "difficulty": "Starter",
    "study": [
      "apple-1"
    ],
    "options": [
      "leaf-1",
      "apple-1",
      "rabbit-1",
      "clock-1"
    ]
  },
  {
    "id": "campaign:starter:05",
    "difficulty": "Starter",
    "study": [
      "lantern-1"
    ],
    "options": [
      "lantern-1",
      "guitar-1",
      "apple-1",
      "rabbit-1"
    ]
  },
  {
    "id": "campaign:starter:06",
    "difficulty": "Starter",
    "study": [
      "balloon-1"
    ],
    "options": [
      "teapot-1",
      "camera-1",
      "balloon-1",
      "umbrella-1"
    ]
  },
  {
    "id": "campaign:starter:07",
    "difficulty": "Starter",
    "study": [
      "bird-1"
    ],
    "options": [
      "pear-1",
      "bird-1",
      "camera-1",
      "book-1"
    ]
  },
  {
    "id": "campaign:starter:08",
    "difficulty": "Starter",
    "study": [
      "pear-1"
    ],
    "options": [
      "camera-1",
      "rabbit-1",
      "kite-1",
      "pear-1"
    ]
  },
  {
    "id": "campaign:starter:09",
    "difficulty": "Starter",
    "study": [
      "key-1"
    ],
    "options": [
      "rabbit-1",
      "shell-1",
      "key-1",
      "boot-1"
    ]
  },
  {
    "id": "campaign:starter:10",
    "difficulty": "Starter",
    "study": [
      "bird-1"
    ],
    "options": [
      "pear-1",
      "umbrella-1",
      "key-1",
      "bird-1"
    ]
  },
  {
    "id": "campaign:starter:11",
    "difficulty": "Starter",
    "study": [
      "pear-1"
    ],
    "options": [
      "pear-1",
      "fish-1",
      "camera-1",
      "mug-1"
    ]
  },
  {
    "id": "campaign:starter:12",
    "difficulty": "Starter",
    "study": [
      "lantern-1"
    ],
    "options": [
      "umbrella-1",
      "lantern-1",
      "balloon-1",
      "fish-1"
    ]
  },
  {
    "id": "campaign:junior:01",
    "difficulty": "Junior",
    "study": [
      "apple-1",
      "boat-1"
    ],
    "options": [
      "rabbit-1",
      "teapot-1",
      "clock-1",
      "apple-1",
      "boat-1",
      "bird-1"
    ]
  },
  {
    "id": "campaign:junior:02",
    "difficulty": "Junior",
    "study": [
      "bird-1",
      "kite-1"
    ],
    "options": [
      "bird-1",
      "kite-1",
      "shell-1",
      "boot-1",
      "key-1",
      "boat-1"
    ]
  },
  {
    "id": "campaign:junior:03",
    "difficulty": "Junior",
    "study": [
      "boot-1",
      "boat-1"
    ],
    "options": [
      "boot-1",
      "balloon-1",
      "rabbit-1",
      "boat-1",
      "book-1",
      "key-1"
    ]
  },
  {
    "id": "campaign:junior:04",
    "difficulty": "Junior",
    "study": [
      "rocket-1",
      "mug-1"
    ],
    "options": [
      "boot-1",
      "hat-1",
      "shell-1",
      "rocket-1",
      "rabbit-1",
      "mug-1"
    ]
  },
  {
    "id": "campaign:junior:05",
    "difficulty": "Junior",
    "study": [
      "bicycle-1",
      "flower-1"
    ],
    "options": [
      "bicycle-1",
      "bird-1",
      "clock-1",
      "mug-1",
      "lantern-1",
      "flower-1"
    ]
  },
  {
    "id": "campaign:junior:06",
    "difficulty": "Junior",
    "study": [
      "fish-1",
      "flower-1"
    ],
    "options": [
      "guitar-1",
      "hat-1",
      "lantern-1",
      "umbrella-1",
      "fish-1",
      "flower-1"
    ]
  },
  {
    "id": "campaign:junior:07",
    "difficulty": "Junior",
    "study": [
      "rabbit-1",
      "bicycle-1"
    ],
    "options": [
      "shell-1",
      "hat-1",
      "rabbit-1",
      "bird-1",
      "bicycle-1",
      "lantern-1"
    ]
  },
  {
    "id": "campaign:junior:08",
    "difficulty": "Junior",
    "study": [
      "balloon-1",
      "mug-1"
    ],
    "options": [
      "fish-1",
      "boat-1",
      "balloon-1",
      "mug-1",
      "shell-1",
      "bird-1"
    ]
  },
  {
    "id": "campaign:junior:09",
    "difficulty": "Junior",
    "study": [
      "rocket-1",
      "pear-1"
    ],
    "options": [
      "flower-1",
      "rocket-1",
      "leaf-1",
      "bicycle-1",
      "pear-1",
      "umbrella-1"
    ]
  },
  {
    "id": "campaign:junior:10",
    "difficulty": "Junior",
    "study": [
      "guitar-1",
      "camera-1"
    ],
    "options": [
      "mug-1",
      "guitar-1",
      "book-1",
      "teapot-1",
      "lantern-1",
      "camera-1"
    ]
  },
  {
    "id": "campaign:junior:11",
    "difficulty": "Junior",
    "study": [
      "flower-1",
      "fish-1"
    ],
    "options": [
      "flower-1",
      "hat-1",
      "fish-1",
      "umbrella-1",
      "balloon-1",
      "rabbit-1"
    ]
  },
  {
    "id": "campaign:junior:12",
    "difficulty": "Junior",
    "study": [
      "apple-1",
      "book-1"
    ],
    "options": [
      "rabbit-1",
      "apple-1",
      "book-1",
      "rocket-1",
      "boat-1",
      "key-1"
    ]
  },
  {
    "id": "campaign:expert:01",
    "difficulty": "Expert",
    "study": [
      "boat-2@turn-90",
      "teapot-1@mirror-left-right",
      "boot-2"
    ],
    "traps": [
      {
        "kind": "structural",
        "source": 0
      },
      {
        "kind": "structural",
        "source": 1
      },
      {
        "kind": "structural",
        "source": 2
      },
      {
        "kind": "rotation",
        "source": 1,
        "quarterTurns": 3
      },
      {
        "kind": "reflection",
        "source": 0,
        "axis": "diagonal"
      }
    ],
    "optionOrder": [
      3,
      7,
      6,
      5,
      4,
      0,
      2,
      1
    ]
  },
  {
    "id": "campaign:expert:02",
    "difficulty": "Expert",
    "study": [
      "key-2@turn-180",
      "bird-1@mirror-top-bottom",
      "boat-2@mirror-top-bottom"
    ],
    "traps": [
      {
        "kind": "structural",
        "source": 0
      },
      {
        "kind": "structural",
        "source": 1
      },
      {
        "kind": "structural",
        "source": 2
      },
      {
        "kind": "rotation",
        "source": 2,
        "quarterTurns": 1
      },
      {
        "kind": "reflection",
        "source": 1,
        "axis": "diagonal"
      }
    ],
    "optionOrder": [
      1,
      2,
      4,
      5,
      0,
      3,
      7,
      6
    ]
  },
  {
    "id": "campaign:expert:03",
    "difficulty": "Expert",
    "study": [
      "boat-2@turn-270",
      "mug-1@mirror-diagonal",
      "bird-1@turn-180"
    ],
    "traps": [
      {
        "kind": "structural",
        "source": 0
      },
      {
        "kind": "structural",
        "source": 1
      },
      {
        "kind": "structural",
        "source": 2
      },
      {
        "kind": "rotation",
        "source": 0,
        "quarterTurns": 3
      },
      {
        "kind": "reflection",
        "source": 2,
        "axis": "diagonal"
      }
    ],
    "optionOrder": [
      0,
      1,
      7,
      2,
      5,
      3,
      4,
      6
    ]
  },
  {
    "id": "campaign:expert:04",
    "difficulty": "Expert",
    "study": [
      "guitar-2@turn-90",
      "boot-2@mirror-antidiagonal",
      "boat-1@mirror-antidiagonal"
    ],
    "traps": [
      {
        "kind": "structural",
        "source": 0
      },
      {
        "kind": "structural",
        "source": 1
      },
      {
        "kind": "structural",
        "source": 2
      },
      {
        "kind": "rotation",
        "source": 2,
        "quarterTurns": 2
      },
      {
        "kind": "reflection",
        "source": 0,
        "axis": "antidiagonal"
      }
    ],
    "optionOrder": [
      1,
      4,
      3,
      7,
      2,
      0,
      6,
      5
    ]
  },
  {
    "id": "campaign:expert:05",
    "difficulty": "Expert",
    "study": [
      "boat-2@turn-180",
      "bird-2@mirror-left-right",
      "teapot-2@mirror-left-right"
    ],
    "traps": [
      {
        "kind": "structural",
        "source": 0
      },
      {
        "kind": "structural",
        "source": 1
      },
      {
        "kind": "structural",
        "source": 2
      },
      {
        "kind": "rotation",
        "source": 2,
        "quarterTurns": 2
      },
      {
        "kind": "reflection",
        "source": 0,
        "axis": "antidiagonal"
      }
    ],
    "optionOrder": [
      7,
      0,
      1,
      6,
      5,
      4,
      2,
      3
    ]
  },
  {
    "id": "campaign:expert:06",
    "difficulty": "Expert",
    "study": [
      "teapot-1@turn-270",
      "bird-1@mirror-top-bottom",
      "guitar-1@turn-90"
    ],
    "traps": [
      {
        "kind": "structural",
        "source": 0
      },
      {
        "kind": "structural",
        "source": 1
      },
      {
        "kind": "structural",
        "source": 2
      },
      {
        "kind": "rotation",
        "source": 2,
        "quarterTurns": 2
      },
      {
        "kind": "reflection",
        "source": 1,
        "axis": "left-right"
      }
    ],
    "optionOrder": [
      2,
      6,
      4,
      3,
      5,
      1,
      7,
      0
    ]
  },
  {
    "id": "campaign:expert:07",
    "difficulty": "Expert",
    "study": [
      "bird-2@turn-90",
      "mug-1@mirror-diagonal",
      "boot-1@mirror-diagonal"
    ],
    "traps": [
      {
        "kind": "structural",
        "source": 0
      },
      {
        "kind": "structural",
        "source": 1
      },
      {
        "kind": "structural",
        "source": 2
      },
      {
        "kind": "rotation",
        "source": 1,
        "quarterTurns": 3
      },
      {
        "kind": "reflection",
        "source": 0,
        "axis": "left-right"
      }
    ],
    "optionOrder": [
      5,
      7,
      3,
      0,
      2,
      6,
      1,
      4
    ]
  },
  {
    "id": "campaign:expert:08",
    "difficulty": "Expert",
    "study": [
      "bird-2@turn-180",
      "key-1@mirror-antidiagonal",
      "guitar-2@turn-270"
    ],
    "traps": [
      {
        "kind": "structural",
        "source": 0
      },
      {
        "kind": "structural",
        "source": 1
      },
      {
        "kind": "structural",
        "source": 2
      },
      {
        "kind": "rotation",
        "source": 2,
        "quarterTurns": 1
      },
      {
        "kind": "reflection",
        "source": 0,
        "axis": "top-bottom"
      }
    ],
    "optionOrder": [
      7,
      5,
      0,
      6,
      1,
      4,
      3,
      2
    ]
  },
  {
    "id": "campaign:expert:09",
    "difficulty": "Expert",
    "study": [
      "mug-2@turn-270",
      "boot-2@mirror-left-right",
      "teapot-1"
    ],
    "traps": [
      {
        "kind": "structural",
        "source": 0
      },
      {
        "kind": "structural",
        "source": 1
      },
      {
        "kind": "structural",
        "source": 2
      },
      {
        "kind": "rotation",
        "source": 1,
        "quarterTurns": 3
      },
      {
        "kind": "reflection",
        "source": 0,
        "axis": "left-right"
      }
    ],
    "optionOrder": [
      5,
      7,
      1,
      4,
      3,
      6,
      2,
      0
    ]
  },
  {
    "id": "campaign:expert:10",
    "difficulty": "Expert",
    "study": [
      "guitar-1@turn-90",
      "mug-1@mirror-top-bottom",
      "key-2@mirror-top-bottom"
    ],
    "traps": [
      {
        "kind": "structural",
        "source": 0
      },
      {
        "kind": "structural",
        "source": 1
      },
      {
        "kind": "structural",
        "source": 2
      },
      {
        "kind": "rotation",
        "source": 2,
        "quarterTurns": 2
      },
      {
        "kind": "reflection",
        "source": 0,
        "axis": "diagonal"
      }
    ],
    "optionOrder": [
      0,
      6,
      5,
      2,
      3,
      7,
      4,
      1
    ]
  },
  {
    "id": "campaign:expert:11",
    "difficulty": "Expert",
    "study": [
      "boot-2@turn-180",
      "teapot-2@mirror-diagonal",
      "key-1@turn-180"
    ],
    "traps": [
      {
        "kind": "structural",
        "source": 0
      },
      {
        "kind": "structural",
        "source": 1
      },
      {
        "kind": "structural",
        "source": 2
      },
      {
        "kind": "rotation",
        "source": 0,
        "quarterTurns": 2
      },
      {
        "kind": "reflection",
        "source": 1,
        "axis": "left-right"
      }
    ],
    "optionOrder": [
      5,
      3,
      1,
      2,
      6,
      4,
      0,
      7
    ]
  },
  {
    "id": "campaign:expert:12",
    "difficulty": "Expert",
    "study": [
      "mug-1@turn-270",
      "key-2@mirror-antidiagonal",
      "guitar-1@mirror-antidiagonal"
    ],
    "traps": [
      {
        "kind": "structural",
        "source": 0
      },
      {
        "kind": "structural",
        "source": 1
      },
      {
        "kind": "structural",
        "source": 2
      },
      {
        "kind": "rotation",
        "source": 1,
        "quarterTurns": 2
      },
      {
        "kind": "reflection",
        "source": 2,
        "axis": "diagonal"
      }
    ],
    "optionOrder": [
      5,
      2,
      1,
      4,
      3,
      0,
      6,
      7
    ]
  },
  {
    "id": "campaign:wizard:01",
    "difficulty": "Wizard",
    "study": [
      "mug-1@turn-90",
      "mug-2@mirror-left-right",
      "guitar-2"
    ],
    "traps": [
      {
        "kind": "structural",
        "source": 2
      },
      {
        "kind": "rotation",
        "source": 0,
        "quarterTurns": 2
      },
      {
        "kind": "reflection",
        "source": 1,
        "axis": "top-bottom"
      },
      {
        "kind": "rotation",
        "source": 2,
        "quarterTurns": 3
      },
      {
        "kind": "reflection",
        "source": 2,
        "axis": "antidiagonal"
      }
    ],
    "optionOrder": [
      1,
      6,
      3,
      4,
      7,
      0,
      5,
      2
    ]
  },
  {
    "id": "campaign:wizard:02",
    "difficulty": "Wizard",
    "study": [
      "boot-2@turn-180",
      "boot-1@mirror-top-bottom",
      "teapot-2@mirror-top-bottom"
    ],
    "traps": [
      {
        "kind": "structural",
        "source": 2
      },
      {
        "kind": "rotation",
        "source": 0,
        "quarterTurns": 3
      },
      {
        "kind": "reflection",
        "source": 1,
        "axis": "top-bottom"
      },
      {
        "kind": "rotation",
        "source": 2,
        "quarterTurns": 1
      },
      {
        "kind": "reflection",
        "source": 2,
        "axis": "diagonal"
      }
    ],
    "optionOrder": [
      7,
      0,
      4,
      1,
      3,
      6,
      2,
      5
    ]
  },
  {
    "id": "campaign:wizard:03",
    "difficulty": "Wizard",
    "study": [
      "boat-2@turn-270",
      "boat-1@mirror-diagonal",
      "bird-1@turn-180"
    ],
    "traps": [
      {
        "kind": "structural",
        "source": 2
      },
      {
        "kind": "reflection",
        "source": 0,
        "axis": "left-right"
      },
      {
        "kind": "rotation",
        "source": 1,
        "quarterTurns": 1
      },
      {
        "kind": "rotation",
        "source": 2,
        "quarterTurns": 1
      },
      {
        "kind": "reflection",
        "source": 2,
        "axis": "antidiagonal"
      }
    ],
    "optionOrder": [
      7,
      6,
      4,
      1,
      2,
      0,
      5,
      3
    ]
  },
  {
    "id": "campaign:wizard:04",
    "difficulty": "Wizard",
    "study": [
      "guitar-1@turn-90",
      "guitar-2@mirror-antidiagonal",
      "key-1@mirror-antidiagonal"
    ],
    "traps": [
      {
        "kind": "structural",
        "source": 2
      },
      {
        "kind": "rotation",
        "source": 0,
        "quarterTurns": 3
      },
      {
        "kind": "reflection",
        "source": 1,
        "axis": "diagonal"
      },
      {
        "kind": "rotation",
        "source": 2,
        "quarterTurns": 1
      },
      {
        "kind": "reflection",
        "source": 2,
        "axis": "left-right"
      }
    ],
    "optionOrder": [
      4,
      5,
      6,
      3,
      2,
      1,
      0,
      7
    ]
  },
  {
    "id": "campaign:wizard:05",
    "difficulty": "Wizard",
    "study": [
      "teapot-2@turn-180",
      "teapot-1@mirror-left-right",
      "mug-1@mirror-left-right"
    ],
    "traps": [
      {
        "kind": "structural",
        "source": 2
      },
      {
        "kind": "reflection",
        "source": 0,
        "axis": "antidiagonal"
      },
      {
        "kind": "rotation",
        "source": 1,
        "quarterTurns": 2
      },
      {
        "kind": "rotation",
        "source": 2,
        "quarterTurns": 2
      },
      {
        "kind": "reflection",
        "source": 2,
        "axis": "left-right"
      }
    ],
    "optionOrder": [
      4,
      1,
      0,
      6,
      3,
      5,
      2,
      7
    ]
  },
  {
    "id": "campaign:wizard:06",
    "difficulty": "Wizard",
    "study": [
      "bird-2@turn-270",
      "bird-1@mirror-top-bottom",
      "boot-1@turn-90"
    ],
    "traps": [
      {
        "kind": "structural",
        "source": 2
      },
      {
        "kind": "rotation",
        "source": 0,
        "quarterTurns": 2
      },
      {
        "kind": "reflection",
        "source": 1,
        "axis": "top-bottom"
      },
      {
        "kind": "rotation",
        "source": 2,
        "quarterTurns": 2
      },
      {
        "kind": "reflection",
        "source": 2,
        "axis": "diagonal"
      }
    ],
    "optionOrder": [
      0,
      7,
      6,
      5,
      1,
      4,
      3,
      2
    ]
  },
  {
    "id": "campaign:wizard:07",
    "difficulty": "Wizard",
    "study": [
      "key-2@turn-90",
      "key-1@mirror-diagonal",
      "boat-1@mirror-diagonal"
    ],
    "traps": [
      {
        "kind": "structural",
        "source": 2
      },
      {
        "kind": "reflection",
        "source": 0,
        "axis": "top-bottom"
      },
      {
        "kind": "rotation",
        "source": 1,
        "quarterTurns": 1
      },
      {
        "kind": "rotation",
        "source": 2,
        "quarterTurns": 3
      },
      {
        "kind": "reflection",
        "source": 2,
        "axis": "left-right"
      }
    ],
    "optionOrder": [
      1,
      2,
      3,
      0,
      5,
      4,
      7,
      6
    ]
  },
  {
    "id": "campaign:wizard:08",
    "difficulty": "Wizard",
    "study": [
      "mug-1@turn-180",
      "mug-2@mirror-antidiagonal",
      "guitar-2@turn-270"
    ],
    "traps": [
      {
        "kind": "structural",
        "source": 2
      },
      {
        "kind": "rotation",
        "source": 0,
        "quarterTurns": 3
      },
      {
        "kind": "reflection",
        "source": 1,
        "axis": "left-right"
      },
      {
        "kind": "rotation",
        "source": 2,
        "quarterTurns": 2
      },
      {
        "kind": "reflection",
        "source": 2,
        "axis": "left-right"
      }
    ],
    "optionOrder": [
      6,
      2,
      1,
      0,
      7,
      3,
      5,
      4
    ]
  },
  {
    "id": "campaign:wizard:09",
    "difficulty": "Wizard",
    "study": [
      "boot-1@turn-270",
      "boot-2@mirror-left-right",
      "teapot-1"
    ],
    "traps": [
      {
        "kind": "structural",
        "source": 2
      },
      {
        "kind": "rotation",
        "source": 0,
        "quarterTurns": 2
      },
      {
        "kind": "reflection",
        "source": 1,
        "axis": "left-right"
      },
      {
        "kind": "rotation",
        "source": 2,
        "quarterTurns": 2
      },
      {
        "kind": "reflection",
        "source": 2,
        "axis": "antidiagonal"
      }
    ],
    "optionOrder": [
      0,
      1,
      5,
      4,
      6,
      7,
      3,
      2
    ]
  },
  {
    "id": "campaign:wizard:10",
    "difficulty": "Wizard",
    "study": [
      "boat-2@turn-90",
      "boat-1@mirror-top-bottom",
      "bird-2@mirror-top-bottom"
    ],
    "traps": [
      {
        "kind": "structural",
        "source": 2
      },
      {
        "kind": "rotation",
        "source": 0,
        "quarterTurns": 1
      },
      {
        "kind": "reflection",
        "source": 1,
        "axis": "antidiagonal"
      },
      {
        "kind": "rotation",
        "source": 2,
        "quarterTurns": 1
      },
      {
        "kind": "reflection",
        "source": 2,
        "axis": "top-bottom"
      }
    ],
    "optionOrder": [
      3,
      6,
      4,
      5,
      7,
      2,
      1,
      0
    ]
  },
  {
    "id": "campaign:wizard:11",
    "difficulty": "Wizard",
    "study": [
      "guitar-2@turn-180",
      "guitar-1@mirror-diagonal",
      "key-1@turn-180"
    ],
    "traps": [
      {
        "kind": "structural",
        "source": 2
      },
      {
        "kind": "reflection",
        "source": 0,
        "axis": "diagonal"
      },
      {
        "kind": "rotation",
        "source": 1,
        "quarterTurns": 3
      },
      {
        "kind": "rotation",
        "source": 2,
        "quarterTurns": 2
      },
      {
        "kind": "reflection",
        "source": 2,
        "axis": "top-bottom"
      }
    ],
    "optionOrder": [
      5,
      6,
      1,
      2,
      0,
      4,
      7,
      3
    ]
  },
  {
    "id": "campaign:wizard:12",
    "difficulty": "Wizard",
    "study": [
      "teapot-1@turn-270",
      "teapot-2@mirror-antidiagonal",
      "mug-2@mirror-antidiagonal"
    ],
    "traps": [
      {
        "kind": "structural",
        "source": 2
      },
      {
        "kind": "reflection",
        "source": 0,
        "axis": "antidiagonal"
      },
      {
        "kind": "rotation",
        "source": 1,
        "quarterTurns": 1
      },
      {
        "kind": "rotation",
        "source": 2,
        "quarterTurns": 2
      },
      {
        "kind": "reflection",
        "source": 2,
        "axis": "antidiagonal"
      }
    ],
    "optionOrder": [
      5,
      4,
      0,
      3,
      2,
      1,
      7,
      6
    ]
  }
] as const satisfies readonly AuthoredRoundSpec[];

export const AUTHORED_JOURNEY_DATA = {
  "junior-2": [
    {
      "id": "journey:junior-2:01",
      "difficulty": "Junior",
      "study": [
        "book-1",
        "hat-1"
      ],
      "options": [
        "book-1",
        "rabbit-1",
        "mug-1",
        "bird-1",
        "hat-1",
        "shell-1"
      ]
    },
    {
      "id": "journey:junior-2:02",
      "difficulty": "Junior",
      "study": [
        "clock-1",
        "boot-1"
      ],
      "options": [
        "fish-1",
        "kite-1",
        "shell-1",
        "umbrella-1",
        "clock-1",
        "boot-1"
      ]
    },
    {
      "id": "journey:junior-2:03",
      "difficulty": "Junior",
      "study": [
        "lantern-1",
        "key-1"
      ],
      "options": [
        "flower-1",
        "boat-1",
        "lantern-1",
        "key-1",
        "apple-1",
        "kite-1"
      ]
    },
    {
      "id": "journey:junior-2:04",
      "difficulty": "Junior",
      "study": [
        "fish-1",
        "key-1"
      ],
      "options": [
        "camera-1",
        "fish-1",
        "mug-1",
        "boat-1",
        "key-1",
        "kite-1"
      ]
    },
    {
      "id": "journey:junior-2:05",
      "difficulty": "Junior",
      "study": [
        "book-1",
        "key-1"
      ],
      "options": [
        "book-1",
        "key-1",
        "balloon-1",
        "hat-1",
        "camera-1",
        "pear-1"
      ]
    },
    {
      "id": "journey:junior-2:06",
      "difficulty": "Junior",
      "study": [
        "book-1",
        "key-1"
      ],
      "options": [
        "balloon-1",
        "kite-1",
        "rocket-1",
        "book-1",
        "flower-1",
        "key-1"
      ]
    },
    {
      "id": "journey:junior-2:07",
      "difficulty": "Junior",
      "study": [
        "rabbit-1",
        "fish-1"
      ],
      "options": [
        "rabbit-1",
        "rocket-1",
        "lantern-1",
        "fish-1",
        "kite-1",
        "shell-1"
      ]
    },
    {
      "id": "journey:junior-2:08",
      "difficulty": "Junior",
      "study": [
        "lantern-1",
        "teapot-1"
      ],
      "options": [
        "hat-1",
        "lantern-1",
        "rabbit-1",
        "teapot-1",
        "boat-1",
        "apple-1"
      ]
    },
    {
      "id": "journey:junior-2:09",
      "difficulty": "Junior",
      "study": [
        "pear-1",
        "key-1"
      ],
      "options": [
        "pear-1",
        "boat-1",
        "leaf-1",
        "lantern-1",
        "flower-1",
        "key-1"
      ]
    },
    {
      "id": "journey:junior-2:10",
      "difficulty": "Junior",
      "study": [
        "teapot-1",
        "hat-1"
      ],
      "options": [
        "mug-1",
        "teapot-1",
        "hat-1",
        "rocket-1",
        "leaf-1",
        "fish-1"
      ]
    },
    {
      "id": "journey:junior-2:11",
      "difficulty": "Junior",
      "study": [
        "boot-1",
        "bicycle-1"
      ],
      "options": [
        "flower-1",
        "camera-1",
        "boot-1",
        "guitar-1",
        "pear-1",
        "bicycle-1"
      ]
    },
    {
      "id": "journey:junior-2:12",
      "difficulty": "Junior",
      "study": [
        "guitar-1",
        "flower-1"
      ],
      "options": [
        "book-1",
        "mug-1",
        "guitar-1",
        "pear-1",
        "flower-1",
        "clock-1"
      ]
    }
  ],
  "expert-2": [
    {
      "id": "journey:expert-2:01",
      "difficulty": "Expert",
      "study": [
        "boat-2@turn-180",
        "guitar-1@mirror-top-bottom",
        "bird-1@turn-90"
      ],
      "traps": [
        {
          "kind": "structural",
          "source": 0
        },
        {
          "kind": "structural",
          "source": 1
        },
        {
          "kind": "structural",
          "source": 2
        },
        {
          "kind": "rotation",
          "source": 1,
          "quarterTurns": 2
        },
        {
          "kind": "reflection",
          "source": 0,
          "axis": "top-bottom"
        }
      ],
      "optionOrder": [
        5,
        0,
        4,
        3,
        6,
        1,
        7,
        2
      ]
    },
    {
      "id": "journey:expert-2:02",
      "difficulty": "Expert",
      "study": [
        "mug-2@turn-270",
        "boat-1@mirror-diagonal",
        "guitar-2@mirror-diagonal"
      ],
      "traps": [
        {
          "kind": "structural",
          "source": 0
        },
        {
          "kind": "structural",
          "source": 1
        },
        {
          "kind": "structural",
          "source": 2
        },
        {
          "kind": "rotation",
          "source": 0,
          "quarterTurns": 2
        },
        {
          "kind": "reflection",
          "source": 1,
          "axis": "antidiagonal"
        }
      ],
      "optionOrder": [
        1,
        0,
        3,
        2,
        4,
        6,
        5,
        7
      ]
    },
    {
      "id": "journey:expert-2:03",
      "difficulty": "Expert",
      "study": [
        "key-1@turn-90",
        "teapot-2@mirror-antidiagonal",
        "guitar-1@turn-270"
      ],
      "traps": [
        {
          "kind": "structural",
          "source": 0
        },
        {
          "kind": "structural",
          "source": 1
        },
        {
          "kind": "structural",
          "source": 2
        },
        {
          "kind": "rotation",
          "source": 1,
          "quarterTurns": 1
        },
        {
          "kind": "reflection",
          "source": 0,
          "axis": "top-bottom"
        }
      ],
      "optionOrder": [
        7,
        4,
        0,
        6,
        3,
        2,
        5,
        1
      ]
    },
    {
      "id": "journey:expert-2:04",
      "difficulty": "Expert",
      "study": [
        "key-2@turn-180",
        "bird-2@mirror-left-right",
        "boat-2"
      ],
      "traps": [
        {
          "kind": "structural",
          "source": 0
        },
        {
          "kind": "structural",
          "source": 1
        },
        {
          "kind": "structural",
          "source": 2
        },
        {
          "kind": "rotation",
          "source": 2,
          "quarterTurns": 3
        },
        {
          "kind": "reflection",
          "source": 0,
          "axis": "top-bottom"
        }
      ],
      "optionOrder": [
        4,
        1,
        0,
        5,
        6,
        7,
        2,
        3
      ]
    },
    {
      "id": "journey:expert-2:05",
      "difficulty": "Expert",
      "study": [
        "key-1@turn-270",
        "bird-1@mirror-top-bottom",
        "teapot-2@mirror-top-bottom"
      ],
      "traps": [
        {
          "kind": "structural",
          "source": 0
        },
        {
          "kind": "structural",
          "source": 1
        },
        {
          "kind": "structural",
          "source": 2
        },
        {
          "kind": "rotation",
          "source": 2,
          "quarterTurns": 3
        },
        {
          "kind": "reflection",
          "source": 1,
          "axis": "antidiagonal"
        }
      ],
      "optionOrder": [
        6,
        3,
        4,
        0,
        2,
        7,
        1,
        5
      ]
    },
    {
      "id": "journey:expert-2:06",
      "difficulty": "Expert",
      "study": [
        "teapot-1@turn-90",
        "bird-2@mirror-diagonal",
        "boat-2@turn-180"
      ],
      "traps": [
        {
          "kind": "structural",
          "source": 0
        },
        {
          "kind": "structural",
          "source": 1
        },
        {
          "kind": "structural",
          "source": 2
        },
        {
          "kind": "rotation",
          "source": 0,
          "quarterTurns": 1
        },
        {
          "kind": "reflection",
          "source": 2,
          "axis": "diagonal"
        }
      ],
      "optionOrder": [
        4,
        6,
        7,
        2,
        5,
        1,
        0,
        3
      ]
    },
    {
      "id": "journey:expert-2:07",
      "difficulty": "Expert",
      "study": [
        "boot-1@turn-180",
        "boat-2@mirror-antidiagonal",
        "teapot-1@mirror-antidiagonal"
      ],
      "traps": [
        {
          "kind": "structural",
          "source": 0
        },
        {
          "kind": "structural",
          "source": 1
        },
        {
          "kind": "structural",
          "source": 2
        },
        {
          "kind": "rotation",
          "source": 2,
          "quarterTurns": 2
        },
        {
          "kind": "reflection",
          "source": 1,
          "axis": "antidiagonal"
        }
      ],
      "optionOrder": [
        2,
        3,
        6,
        4,
        1,
        5,
        7,
        0
      ]
    },
    {
      "id": "journey:expert-2:08",
      "difficulty": "Expert",
      "study": [
        "bird-2@turn-270",
        "mug-1@mirror-left-right",
        "guitar-1@mirror-left-right"
      ],
      "traps": [
        {
          "kind": "structural",
          "source": 0
        },
        {
          "kind": "structural",
          "source": 1
        },
        {
          "kind": "structural",
          "source": 2
        },
        {
          "kind": "rotation",
          "source": 0,
          "quarterTurns": 1
        },
        {
          "kind": "reflection",
          "source": 2,
          "axis": "diagonal"
        }
      ],
      "optionOrder": [
        2,
        5,
        0,
        3,
        7,
        6,
        1,
        4
      ]
    },
    {
      "id": "journey:expert-2:09",
      "difficulty": "Expert",
      "study": [
        "mug-1@turn-90",
        "guitar-2@mirror-top-bottom",
        "boot-1@turn-90"
      ],
      "traps": [
        {
          "kind": "structural",
          "source": 0
        },
        {
          "kind": "structural",
          "source": 1
        },
        {
          "kind": "structural",
          "source": 2
        },
        {
          "kind": "rotation",
          "source": 1,
          "quarterTurns": 3
        },
        {
          "kind": "reflection",
          "source": 0,
          "axis": "top-bottom"
        }
      ],
      "optionOrder": [
        1,
        5,
        0,
        6,
        4,
        7,
        3,
        2
      ]
    },
    {
      "id": "journey:expert-2:10",
      "difficulty": "Expert",
      "study": [
        "key-2@turn-180",
        "mug-1@mirror-diagonal",
        "boot-1@mirror-diagonal"
      ],
      "traps": [
        {
          "kind": "structural",
          "source": 0
        },
        {
          "kind": "structural",
          "source": 1
        },
        {
          "kind": "structural",
          "source": 2
        },
        {
          "kind": "rotation",
          "source": 0,
          "quarterTurns": 2
        },
        {
          "kind": "reflection",
          "source": 1,
          "axis": "diagonal"
        }
      ],
      "optionOrder": [
        1,
        6,
        7,
        2,
        0,
        3,
        5,
        4
      ]
    },
    {
      "id": "journey:expert-2:11",
      "difficulty": "Expert",
      "study": [
        "boot-1@turn-270",
        "bird-2@mirror-antidiagonal",
        "key-1@turn-270"
      ],
      "traps": [
        {
          "kind": "structural",
          "source": 0
        },
        {
          "kind": "structural",
          "source": 1
        },
        {
          "kind": "structural",
          "source": 2
        },
        {
          "kind": "rotation",
          "source": 0,
          "quarterTurns": 1
        },
        {
          "kind": "reflection",
          "source": 1,
          "axis": "diagonal"
        }
      ],
      "optionOrder": [
        4,
        0,
        3,
        6,
        7,
        1,
        2,
        5
      ]
    },
    {
      "id": "journey:expert-2:12",
      "difficulty": "Expert",
      "study": [
        "boot-2@turn-90",
        "mug-2@mirror-left-right",
        "teapot-2"
      ],
      "traps": [
        {
          "kind": "structural",
          "source": 0
        },
        {
          "kind": "structural",
          "source": 1
        },
        {
          "kind": "structural",
          "source": 2
        },
        {
          "kind": "rotation",
          "source": 2,
          "quarterTurns": 3
        },
        {
          "kind": "reflection",
          "source": 1,
          "axis": "left-right"
        }
      ],
      "optionOrder": [
        7,
        6,
        4,
        2,
        1,
        0,
        5,
        3
      ]
    }
  ],
  "wizard-2": [
    {
      "id": "journey:wizard-2:01",
      "difficulty": "Wizard",
      "study": [
        "teapot-1@turn-180",
        "teapot-2@mirror-top-bottom",
        "bird-1@turn-90"
      ],
      "traps": [
        {
          "kind": "structural",
          "source": 2
        },
        {
          "kind": "reflection",
          "source": 0,
          "axis": "diagonal"
        },
        {
          "kind": "rotation",
          "source": 1,
          "quarterTurns": 2
        },
        {
          "kind": "rotation",
          "source": 2,
          "quarterTurns": 2
        },
        {
          "kind": "reflection",
          "source": 2,
          "axis": "left-right"
        }
      ],
      "optionOrder": [
        7,
        0,
        2,
        5,
        3,
        6,
        1,
        4
      ]
    },
    {
      "id": "journey:wizard-2:02",
      "difficulty": "Wizard",
      "study": [
        "mug-1@turn-270",
        "mug-2@mirror-diagonal",
        "boot-1@mirror-diagonal"
      ],
      "traps": [
        {
          "kind": "structural",
          "source": 2
        },
        {
          "kind": "reflection",
          "source": 0,
          "axis": "diagonal"
        },
        {
          "kind": "rotation",
          "source": 1,
          "quarterTurns": 3
        },
        {
          "kind": "rotation",
          "source": 2,
          "quarterTurns": 2
        },
        {
          "kind": "reflection",
          "source": 2,
          "axis": "left-right"
        }
      ],
      "optionOrder": [
        6,
        7,
        3,
        5,
        4,
        0,
        2,
        1
      ]
    },
    {
      "id": "journey:wizard-2:03",
      "difficulty": "Wizard",
      "study": [
        "key-1@turn-90",
        "key-2@mirror-antidiagonal",
        "guitar-1@turn-270"
      ],
      "traps": [
        {
          "kind": "structural",
          "source": 2
        },
        {
          "kind": "rotation",
          "source": 0,
          "quarterTurns": 1
        },
        {
          "kind": "reflection",
          "source": 1,
          "axis": "antidiagonal"
        },
        {
          "kind": "rotation",
          "source": 2,
          "quarterTurns": 3
        },
        {
          "kind": "reflection",
          "source": 2,
          "axis": "diagonal"
        }
      ],
      "optionOrder": [
        2,
        3,
        4,
        5,
        1,
        7,
        0,
        6
      ]
    },
    {
      "id": "journey:wizard-2:04",
      "difficulty": "Wizard",
      "study": [
        "bird-2@turn-180",
        "bird-1@mirror-left-right",
        "boat-1"
      ],
      "traps": [
        {
          "kind": "structural",
          "source": 2
        },
        {
          "kind": "reflection",
          "source": 0,
          "axis": "antidiagonal"
        },
        {
          "kind": "rotation",
          "source": 1,
          "quarterTurns": 3
        },
        {
          "kind": "rotation",
          "source": 2,
          "quarterTurns": 2
        },
        {
          "kind": "reflection",
          "source": 2,
          "axis": "left-right"
        }
      ],
      "optionOrder": [
        0,
        7,
        6,
        1,
        2,
        3,
        5,
        4
      ]
    },
    {
      "id": "journey:wizard-2:05",
      "difficulty": "Wizard",
      "study": [
        "boot-1@turn-270",
        "boot-2@mirror-top-bottom",
        "teapot-2@mirror-top-bottom"
      ],
      "traps": [
        {
          "kind": "structural",
          "source": 2
        },
        {
          "kind": "reflection",
          "source": 0,
          "axis": "left-right"
        },
        {
          "kind": "rotation",
          "source": 1,
          "quarterTurns": 1
        },
        {
          "kind": "rotation",
          "source": 2,
          "quarterTurns": 3
        },
        {
          "kind": "reflection",
          "source": 2,
          "axis": "left-right"
        }
      ],
      "optionOrder": [
        0,
        4,
        6,
        1,
        7,
        5,
        3,
        2
      ]
    },
    {
      "id": "journey:wizard-2:06",
      "difficulty": "Wizard",
      "study": [
        "guitar-1@turn-90",
        "guitar-2@mirror-diagonal",
        "mug-2@turn-180"
      ],
      "traps": [
        {
          "kind": "structural",
          "source": 2
        },
        {
          "kind": "rotation",
          "source": 0,
          "quarterTurns": 2
        },
        {
          "kind": "reflection",
          "source": 1,
          "axis": "top-bottom"
        },
        {
          "kind": "rotation",
          "source": 2,
          "quarterTurns": 2
        },
        {
          "kind": "reflection",
          "source": 2,
          "axis": "left-right"
        }
      ],
      "optionOrder": [
        7,
        2,
        5,
        0,
        6,
        1,
        3,
        4
      ]
    },
    {
      "id": "journey:wizard-2:07",
      "difficulty": "Wizard",
      "study": [
        "boat-2@turn-180",
        "boat-1@mirror-antidiagonal",
        "key-1@mirror-antidiagonal"
      ],
      "traps": [
        {
          "kind": "structural",
          "source": 2
        },
        {
          "kind": "reflection",
          "source": 0,
          "axis": "top-bottom"
        },
        {
          "kind": "rotation",
          "source": 1,
          "quarterTurns": 3
        },
        {
          "kind": "rotation",
          "source": 2,
          "quarterTurns": 2
        },
        {
          "kind": "reflection",
          "source": 2,
          "axis": "top-bottom"
        }
      ],
      "optionOrder": [
        3,
        4,
        0,
        2,
        6,
        7,
        1,
        5
      ]
    },
    {
      "id": "journey:wizard-2:08",
      "difficulty": "Wizard",
      "study": [
        "teapot-1@turn-270",
        "teapot-2@mirror-left-right",
        "bird-2@mirror-left-right"
      ],
      "traps": [
        {
          "kind": "structural",
          "source": 2
        },
        {
          "kind": "reflection",
          "source": 0,
          "axis": "antidiagonal"
        },
        {
          "kind": "rotation",
          "source": 1,
          "quarterTurns": 3
        },
        {
          "kind": "rotation",
          "source": 2,
          "quarterTurns": 1
        },
        {
          "kind": "reflection",
          "source": 2,
          "axis": "diagonal"
        }
      ],
      "optionOrder": [
        3,
        6,
        1,
        4,
        5,
        7,
        2,
        0
      ]
    },
    {
      "id": "journey:wizard-2:09",
      "difficulty": "Wizard",
      "study": [
        "mug-1@turn-90",
        "mug-2@mirror-top-bottom",
        "boot-2@turn-90"
      ],
      "traps": [
        {
          "kind": "structural",
          "source": 2
        },
        {
          "kind": "reflection",
          "source": 0,
          "axis": "top-bottom"
        },
        {
          "kind": "rotation",
          "source": 1,
          "quarterTurns": 1
        },
        {
          "kind": "rotation",
          "source": 2,
          "quarterTurns": 2
        },
        {
          "kind": "reflection",
          "source": 2,
          "axis": "top-bottom"
        }
      ],
      "optionOrder": [
        6,
        1,
        0,
        3,
        7,
        2,
        4,
        5
      ]
    },
    {
      "id": "journey:wizard-2:10",
      "difficulty": "Wizard",
      "study": [
        "key-2@turn-180",
        "key-1@mirror-diagonal",
        "guitar-2@mirror-diagonal"
      ],
      "traps": [
        {
          "kind": "structural",
          "source": 2
        },
        {
          "kind": "rotation",
          "source": 0,
          "quarterTurns": 3
        },
        {
          "kind": "reflection",
          "source": 1,
          "axis": "diagonal"
        },
        {
          "kind": "rotation",
          "source": 2,
          "quarterTurns": 1
        },
        {
          "kind": "reflection",
          "source": 2,
          "axis": "top-bottom"
        }
      ],
      "optionOrder": [
        2,
        7,
        3,
        6,
        1,
        0,
        5,
        4
      ]
    },
    {
      "id": "journey:wizard-2:11",
      "difficulty": "Wizard",
      "study": [
        "bird-1@turn-270",
        "bird-2@mirror-antidiagonal",
        "boat-1@turn-270"
      ],
      "traps": [
        {
          "kind": "structural",
          "source": 2
        },
        {
          "kind": "reflection",
          "source": 0,
          "axis": "antidiagonal"
        },
        {
          "kind": "rotation",
          "source": 1,
          "quarterTurns": 3
        },
        {
          "kind": "rotation",
          "source": 2,
          "quarterTurns": 1
        },
        {
          "kind": "reflection",
          "source": 2,
          "axis": "antidiagonal"
        }
      ],
      "optionOrder": [
        5,
        0,
        3,
        1,
        2,
        7,
        4,
        6
      ]
    },
    {
      "id": "journey:wizard-2:12",
      "difficulty": "Wizard",
      "study": [
        "boot-2@turn-90",
        "boot-1@mirror-left-right",
        "teapot-2"
      ],
      "traps": [
        {
          "kind": "structural",
          "source": 2
        },
        {
          "kind": "rotation",
          "source": 0,
          "quarterTurns": 3
        },
        {
          "kind": "reflection",
          "source": 1,
          "axis": "left-right"
        },
        {
          "kind": "rotation",
          "source": 2,
          "quarterTurns": 1
        },
        {
          "kind": "reflection",
          "source": 2,
          "axis": "top-bottom"
        }
      ],
      "optionOrder": [
        7,
        0,
        5,
        4,
        3,
        1,
        6,
        2
      ]
    }
  ]
} as const satisfies Readonly<Record<JourneyExtraLevel, readonly AuthoredRoundSpec[]>>;
