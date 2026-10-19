# 3D models

The game loads these at startup (`src/models.js`). Each model is a `.gltf` file with its geometry in a
`.bin` and its textures as separate `.webp` files, so every piece loads by plain URL.

## Spaceships: Quaternius, CC0

From the [Ultimate Spaceships Pack](https://quaternius.com/packs/ultimatespaceships.html) by
[Quaternius](https://quaternius.com), released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain). Taken from the Godot
conversion at [Malcolmnixon/Quaternius-Ultimate-Spaceships-Pack](https://github.com/Malcolmnixon/Quaternius-Ultimate-Spaceships-Pack),
also CC0.

| Files | Ship | In the game |
| --- | --- | --- |
| `ship-striker.*` | Striker (red) | Enemy fighter |
| `ship-dispatcher.*` | Dispatcher (red) | Enemy fighter |
| `ship-omen.*` | Omen (red) | Enemy fighter |
| `ship-bob.*` | Bob (blue) | Recon scout |
| `ship-insurgent.*` | Insurgent (red) | Corvette hull, scaled up to 90 m |
| `ship-imperial.*` | Imperial (red) | Corvette hull, scaled up to 90 m |

## Spacecraft and asteroid: courtesy NASA

From [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources). NASA's 3D models are generally
not subject to copyright in the United States; credit is "Courtesy NASA". Following NASA's media
guidelines, the game doesn't use the NASA insignia or logos (the textures were checked for them) and
doesn't imply that NASA endorses it.

| Files | Original model | In the game |
| --- | --- | --- |
| `derelict-hubble.*` | Hubble Space Telescope (A) | Derelict |
| `derelict-station.*` | International Space Station (ISS) (A) | Derelict |
| `derelict-skylab.*` | Skylab | Derelict |
| `derelict-relay.*` | Tracking and Data Relay Satellites (TDRS) (A) | Derelict |
| `derelict-cassini.*` | Cassini-Huygens (A) | Derelict |
| `derelict-juno.*` | Juno (A) | Derelict |
| `asteroid-bennu.*` | 1999 RQ36 asteroid (Bennu) | Giant asteroid |

## Changes from the originals

- The Quaternius ships were converted from Godot meshes to glTF with their textures.
- The NASA models were decompressed from Draco and welded (and simplified where very detailed), and
  their textures resized.
- All textures were converted to WebP, and every model was split into `.gltf`, `.bin` and texture files.
- In the game, materials are swapped for matte ones and each model is rescaled; see `src/models.js`.
