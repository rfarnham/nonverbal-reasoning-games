import type { JourneyExtraLevel, Round } from "./round-types.ts";

// Frozen, reviewed picture sets. No runtime randomness participates in Campaign or Journey.
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
      "clock-1",
      "bird-1",
      "pear-2"
    ],
    "options": [
      "shell-1",
      "hat-2",
      "bird-2",
      "clock-2",
      "pear-1",
      "clock-1",
      "bird-1",
      "pear-2"
    ]
  },
  {
    "id": "campaign:expert:02",
    "difficulty": "Expert",
    "study": [
      "rocket-1",
      "guitar-2",
      "clock-2"
    ],
    "options": [
      "rocket-1",
      "guitar-2",
      "guitar-1",
      "shell-2",
      "clock-2",
      "rabbit-1",
      "rocket-2",
      "clock-1"
    ]
  },
  {
    "id": "campaign:expert:03",
    "difficulty": "Expert",
    "study": [
      "book-1",
      "camera-2",
      "pear-1"
    ],
    "options": [
      "book-1",
      "camera-2",
      "book-2",
      "pear-1",
      "pear-2",
      "camera-1",
      "lantern-1",
      "clock-2"
    ]
  },
  {
    "id": "campaign:expert:04",
    "difficulty": "Expert",
    "study": [
      "mug-2",
      "pear-2",
      "lantern-1"
    ],
    "options": [
      "mug-2",
      "book-1",
      "pear-1",
      "leaf-2",
      "pear-2",
      "lantern-1",
      "mug-1",
      "lantern-2"
    ]
  },
  {
    "id": "campaign:expert:05",
    "difficulty": "Expert",
    "study": [
      "camera-2",
      "umbrella-1",
      "rabbit-1"
    ],
    "options": [
      "umbrella-2",
      "camera-2",
      "umbrella-1",
      "key-2",
      "camera-1",
      "rabbit-2",
      "rabbit-1",
      "balloon-1"
    ]
  },
  {
    "id": "campaign:expert:06",
    "difficulty": "Expert",
    "study": [
      "lantern-2",
      "camera-2",
      "fish-1"
    ],
    "options": [
      "lantern-2",
      "camera-1",
      "lantern-1",
      "pear-1",
      "fish-2",
      "camera-2",
      "balloon-2",
      "fish-1"
    ]
  },
  {
    "id": "campaign:expert:07",
    "difficulty": "Expert",
    "study": [
      "bird-2",
      "fish-1",
      "bicycle-1"
    ],
    "options": [
      "fish-2",
      "bird-1",
      "balloon-2",
      "bird-2",
      "fish-1",
      "bicycle-2",
      "bicycle-1",
      "kite-1"
    ]
  },
  {
    "id": "campaign:expert:08",
    "difficulty": "Expert",
    "study": [
      "key-2",
      "guitar-1",
      "book-2"
    ],
    "options": [
      "book-1",
      "lantern-2",
      "key-2",
      "guitar-2",
      "guitar-1",
      "key-1",
      "camera-1",
      "book-2"
    ]
  },
  {
    "id": "campaign:expert:09",
    "difficulty": "Expert",
    "study": [
      "leaf-2",
      "guitar-1",
      "mug-1"
    ],
    "options": [
      "rocket-1",
      "leaf-1",
      "leaf-2",
      "lantern-2",
      "mug-2",
      "guitar-2",
      "guitar-1",
      "mug-1"
    ]
  },
  {
    "id": "campaign:expert:10",
    "difficulty": "Expert",
    "study": [
      "umbrella-1",
      "book-2",
      "shell-2"
    ],
    "options": [
      "umbrella-1",
      "shell-1",
      "bicycle-1",
      "book-2",
      "book-1",
      "umbrella-2",
      "bird-2",
      "shell-2"
    ]
  },
  {
    "id": "campaign:expert:11",
    "difficulty": "Expert",
    "study": [
      "flower-1",
      "pear-1",
      "bird-2"
    ],
    "options": [
      "pear-2",
      "flower-2",
      "flower-1",
      "pear-1",
      "shell-2",
      "fish-1",
      "bird-2",
      "bird-1"
    ]
  },
  {
    "id": "campaign:expert:12",
    "difficulty": "Expert",
    "study": [
      "boat-1",
      "key-2",
      "guitar-2"
    ],
    "options": [
      "bicycle-2",
      "boat-1",
      "key-2",
      "guitar-1",
      "teapot-1",
      "guitar-2",
      "boat-2",
      "key-1"
    ]
  },
  {
    "id": "campaign:wizard:01",
    "difficulty": "Wizard",
    "study": [
      "flower-1",
      "boat-1",
      "balloon-2"
    ],
    "options": [
      "flower-1",
      "boat-2",
      "key-1",
      "balloon-1",
      "flower-2",
      "boat-1",
      "mug-2",
      "balloon-2"
    ]
  },
  {
    "id": "campaign:wizard:02",
    "difficulty": "Wizard",
    "study": [
      "mug-2",
      "book-1",
      "leaf-2"
    ],
    "options": [
      "mug-1",
      "mug-2",
      "hat-2",
      "book-1",
      "book-2",
      "leaf-1",
      "leaf-2",
      "camera-1"
    ]
  },
  {
    "id": "campaign:wizard:03",
    "difficulty": "Wizard",
    "study": [
      "clock-2",
      "balloon-1",
      "shell-1"
    ],
    "options": [
      "balloon-2",
      "clock-1",
      "teapot-2",
      "clock-2",
      "balloon-1",
      "shell-1",
      "shell-2",
      "leaf-1"
    ]
  },
  {
    "id": "campaign:wizard:04",
    "difficulty": "Wizard",
    "study": [
      "apple-2",
      "lantern-2",
      "fish-1"
    ],
    "options": [
      "fish-2",
      "lantern-1",
      "apple-1",
      "kite-2",
      "apple-2",
      "lantern-2",
      "fish-1",
      "book-1"
    ]
  },
  {
    "id": "campaign:wizard:05",
    "difficulty": "Wizard",
    "study": [
      "umbrella-1",
      "fish-1",
      "kite-2"
    ],
    "options": [
      "lantern-2",
      "umbrella-1",
      "fish-1",
      "fish-2",
      "flower-1",
      "umbrella-2",
      "kite-2",
      "kite-1"
    ]
  },
  {
    "id": "campaign:wizard:06",
    "difficulty": "Wizard",
    "study": [
      "kite-2",
      "rabbit-2",
      "guitar-1"
    ],
    "options": [
      "kite-2",
      "rabbit-1",
      "lantern-2",
      "kite-1",
      "rabbit-2",
      "guitar-2",
      "camera-1",
      "guitar-1"
    ]
  },
  {
    "id": "campaign:wizard:07",
    "difficulty": "Wizard",
    "study": [
      "bicycle-2",
      "fish-1",
      "apple-1"
    ],
    "options": [
      "bicycle-2",
      "fish-1",
      "umbrella-1",
      "apple-1",
      "bicycle-1",
      "fish-2",
      "teapot-2",
      "apple-2"
    ]
  },
  {
    "id": "campaign:wizard:08",
    "difficulty": "Wizard",
    "study": [
      "bicycle-1",
      "kite-2",
      "bird-2"
    ],
    "options": [
      "boot-2",
      "bicycle-1",
      "kite-2",
      "bird-2",
      "kite-1",
      "bicycle-2",
      "guitar-1",
      "bird-1"
    ]
  },
  {
    "id": "campaign:wizard:09",
    "difficulty": "Wizard",
    "study": [
      "lantern-1",
      "book-1",
      "flower-2"
    ],
    "options": [
      "lantern-1",
      "book-1",
      "balloon-1",
      "flower-1",
      "key-2",
      "lantern-2",
      "book-2",
      "flower-2"
    ]
  },
  {
    "id": "campaign:wizard:10",
    "difficulty": "Wizard",
    "study": [
      "balloon-2",
      "shell-2",
      "mug-1"
    ],
    "options": [
      "mug-2",
      "shell-1",
      "camera-2",
      "balloon-1",
      "lantern-1",
      "balloon-2",
      "shell-2",
      "mug-1"
    ]
  },
  {
    "id": "campaign:wizard:11",
    "difficulty": "Wizard",
    "study": [
      "lantern-2",
      "rabbit-1",
      "flower-1"
    ],
    "options": [
      "fish-1",
      "hat-2",
      "lantern-2",
      "rabbit-1",
      "flower-1",
      "lantern-1",
      "rabbit-2",
      "flower-2"
    ]
  },
  {
    "id": "campaign:wizard:12",
    "difficulty": "Wizard",
    "study": [
      "bird-2",
      "shell-1",
      "umbrella-2"
    ],
    "options": [
      "shell-2",
      "umbrella-1",
      "bird-2",
      "bird-1",
      "shell-1",
      "umbrella-2",
      "bicycle-2",
      "hat-1"
    ]
  }
] as const satisfies readonly Round[];

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
        "apple-1",
        "guitar-2",
        "mug-2"
      ],
      "options": [
        "key-1",
        "apple-1",
        "guitar-1",
        "balloon-2",
        "apple-2",
        "guitar-2",
        "mug-1",
        "mug-2"
      ]
    },
    {
      "id": "journey:expert-2:02",
      "difficulty": "Expert",
      "study": [
        "bird-2",
        "clock-1",
        "apple-1"
      ],
      "options": [
        "bird-2",
        "clock-1",
        "apple-2",
        "apple-1",
        "book-1",
        "clock-2",
        "boat-2",
        "bird-1"
      ]
    },
    {
      "id": "journey:expert-2:03",
      "difficulty": "Expert",
      "study": [
        "guitar-1",
        "kite-2",
        "leaf-2"
      ],
      "options": [
        "kite-1",
        "hat-2",
        "guitar-1",
        "guitar-2",
        "teapot-1",
        "kite-2",
        "leaf-1",
        "leaf-2"
      ]
    },
    {
      "id": "journey:expert-2:04",
      "difficulty": "Expert",
      "study": [
        "key-1",
        "leaf-2",
        "kite-1"
      ],
      "options": [
        "leaf-1",
        "key-1",
        "leaf-2",
        "key-2",
        "pear-2",
        "flower-1",
        "kite-1",
        "kite-2"
      ]
    },
    {
      "id": "journey:expert-2:05",
      "difficulty": "Expert",
      "study": [
        "boot-2",
        "key-1",
        "bicycle-2"
      ],
      "options": [
        "boot-1",
        "bicycle-1",
        "key-2",
        "boot-2",
        "key-1",
        "apple-2",
        "bicycle-2",
        "boat-1"
      ]
    },
    {
      "id": "journey:expert-2:06",
      "difficulty": "Expert",
      "study": [
        "rocket-1",
        "umbrella-1",
        "kite-2"
      ],
      "options": [
        "rocket-2",
        "hat-2",
        "kite-1",
        "rocket-1",
        "shell-1",
        "umbrella-1",
        "kite-2",
        "umbrella-2"
      ]
    },
    {
      "id": "journey:expert-2:07",
      "difficulty": "Expert",
      "study": [
        "camera-1",
        "boot-2",
        "kite-2"
      ],
      "options": [
        "camera-1",
        "hat-2",
        "boot-1",
        "kite-1",
        "boot-2",
        "fish-1",
        "camera-2",
        "kite-2"
      ]
    },
    {
      "id": "journey:expert-2:08",
      "difficulty": "Expert",
      "study": [
        "mug-2",
        "clock-1",
        "pear-1"
      ],
      "options": [
        "mug-2",
        "clock-2",
        "clock-1",
        "pear-2",
        "shell-2",
        "book-1",
        "pear-1",
        "mug-1"
      ]
    },
    {
      "id": "journey:expert-2:09",
      "difficulty": "Expert",
      "study": [
        "pear-2",
        "lantern-1",
        "book-2"
      ],
      "options": [
        "pear-2",
        "lantern-2",
        "lantern-1",
        "pear-1",
        "book-1",
        "clock-2",
        "teapot-1",
        "book-2"
      ]
    },
    {
      "id": "journey:expert-2:10",
      "difficulty": "Expert",
      "study": [
        "camera-2",
        "lantern-1",
        "apple-1"
      ],
      "options": [
        "camera-2",
        "lantern-2",
        "boot-1",
        "lantern-1",
        "apple-1",
        "camera-1",
        "flower-2",
        "apple-2"
      ]
    },
    {
      "id": "journey:expert-2:11",
      "difficulty": "Expert",
      "study": [
        "teapot-2",
        "kite-2",
        "book-1"
      ],
      "options": [
        "kite-1",
        "teapot-2",
        "teapot-1",
        "hat-1",
        "book-2",
        "kite-2",
        "book-1",
        "bird-2"
      ]
    },
    {
      "id": "journey:expert-2:12",
      "difficulty": "Expert",
      "study": [
        "balloon-1",
        "guitar-1",
        "lantern-2"
      ],
      "options": [
        "shell-2",
        "balloon-2",
        "guitar-2",
        "balloon-1",
        "guitar-1",
        "lantern-2",
        "fish-1",
        "lantern-1"
      ]
    }
  ],
  "wizard-2": [
    {
      "id": "journey:wizard-2:01",
      "difficulty": "Wizard",
      "study": [
        "boot-2",
        "hat-1",
        "teapot-2"
      ],
      "options": [
        "fish-1",
        "boot-2",
        "hat-1",
        "boot-1",
        "teapot-1",
        "hat-2",
        "teapot-2",
        "clock-2"
      ]
    },
    {
      "id": "journey:wizard-2:02",
      "difficulty": "Wizard",
      "study": [
        "fish-1",
        "shell-2",
        "umbrella-1"
      ],
      "options": [
        "umbrella-2",
        "rocket-1",
        "boot-2",
        "shell-1",
        "fish-2",
        "fish-1",
        "shell-2",
        "umbrella-1"
      ]
    },
    {
      "id": "journey:wizard-2:03",
      "difficulty": "Wizard",
      "study": [
        "rabbit-2",
        "camera-1",
        "hat-2"
      ],
      "options": [
        "rabbit-2",
        "hat-1",
        "balloon-2",
        "rabbit-1",
        "camera-1",
        "teapot-1",
        "hat-2",
        "camera-2"
      ]
    },
    {
      "id": "journey:wizard-2:04",
      "difficulty": "Wizard",
      "study": [
        "leaf-1",
        "apple-1",
        "rabbit-2"
      ],
      "options": [
        "leaf-1",
        "leaf-2",
        "apple-2",
        "apple-1",
        "rabbit-2",
        "teapot-2",
        "rabbit-1",
        "kite-1"
      ]
    },
    {
      "id": "journey:wizard-2:05",
      "difficulty": "Wizard",
      "study": [
        "clock-1",
        "kite-2",
        "fish-2"
      ],
      "options": [
        "clock-1",
        "mug-1",
        "clock-2",
        "kite-2",
        "fish-1",
        "pear-2",
        "kite-1",
        "fish-2"
      ]
    },
    {
      "id": "journey:wizard-2:06",
      "difficulty": "Wizard",
      "study": [
        "boot-2",
        "flower-1",
        "pear-1"
      ],
      "options": [
        "rocket-1",
        "boot-2",
        "boot-1",
        "flower-1",
        "pear-2",
        "pear-1",
        "flower-2",
        "lantern-2"
      ]
    },
    {
      "id": "journey:wizard-2:07",
      "difficulty": "Wizard",
      "study": [
        "bird-1",
        "teapot-2",
        "shell-2"
      ],
      "options": [
        "bird-2",
        "shell-1",
        "bird-1",
        "teapot-2",
        "teapot-1",
        "key-2",
        "shell-2",
        "rabbit-1"
      ]
    },
    {
      "id": "journey:wizard-2:08",
      "difficulty": "Wizard",
      "study": [
        "clock-1",
        "book-1",
        "leaf-2"
      ],
      "options": [
        "clock-2",
        "apple-2",
        "clock-1",
        "leaf-1",
        "book-2",
        "pear-1",
        "book-1",
        "leaf-2"
      ]
    },
    {
      "id": "journey:wizard-2:09",
      "difficulty": "Wizard",
      "study": [
        "shell-1",
        "teapot-2",
        "kite-2"
      ],
      "options": [
        "leaf-1",
        "shell-1",
        "teapot-2",
        "shell-2",
        "kite-1",
        "kite-2",
        "teapot-1",
        "umbrella-2"
      ]
    },
    {
      "id": "journey:wizard-2:10",
      "difficulty": "Wizard",
      "study": [
        "balloon-1",
        "leaf-1",
        "teapot-2"
      ],
      "options": [
        "balloon-1",
        "balloon-2",
        "leaf-2",
        "teapot-1",
        "leaf-1",
        "teapot-2",
        "mug-2",
        "rabbit-1"
      ]
    },
    {
      "id": "journey:wizard-2:11",
      "difficulty": "Wizard",
      "study": [
        "rabbit-1",
        "boat-2",
        "boot-2"
      ],
      "options": [
        "rabbit-2",
        "rabbit-1",
        "leaf-2",
        "boat-2",
        "boot-2",
        "shell-1",
        "boot-1",
        "boat-1"
      ]
    },
    {
      "id": "journey:wizard-2:12",
      "difficulty": "Wizard",
      "study": [
        "kite-2",
        "leaf-1",
        "bird-1"
      ],
      "options": [
        "bird-2",
        "kite-2",
        "kite-1",
        "leaf-2",
        "apple-2",
        "leaf-1",
        "flower-1",
        "bird-1"
      ]
    }
  ]
} as const satisfies Readonly<Record<JourneyExtraLevel, readonly Round[]>>;
