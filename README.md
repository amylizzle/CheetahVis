# Cheetah 3D Visualization

This repository contains a Python-based Cheetah simulation control system and a JavaScript-based 3D visualization application for a particle beam lattice. 

Particles are rendered (using shaders) as a line whose magnitude and direction corresponds to the momentum of that particle. White-tip indicates the orientation of the momentum. Colour indicates relative magnitude of the momentum where red equals the reference momentum and blue equals the largest momentum difference from the reference.

<img width="1728" height="887" alt="image" src="https://github.com/user-attachments/assets/6b18522f-514b-4e52-80be-9534c9102563" />


[bunchcompressor.webm](https://github.com/user-attachments/assets/5d674290-51d3-4715-822e-e6a6657cf4b4)


## Prerequisites

- Python 3.11+

## Install
`pip install CheetahVis@git+https://github.com/amylizzle/CheetahVis.git`

## Running
Define a beam factory function that returns a new instance of a `cheetah.ParticleBeam`
```
import cheetah

def beam_factory(num_particles:int) -> cheetah.ParticleBeam:
    return cheetah.ParticleBeam.from_twiss(
            num_particles=num_particles,
            ...
        )
```

Pass the factory function and your lattice json to the `CheetahGym` constructor and start the server:

```
import CheetahVis
import asyncio

vis = CheetahVis.CheetahVis("my_cheetah_lattice.json", beam_factory)

# Create the background web and websocket servers
asyncio.run(vis.start_server())

```

## Development
To run the web app in development mode, set `NODE_ENV=development` in the `.env` file. You will then need to run `npm vite` 

## Acknowledgements
This code is substantial reworking of the 3D visualisation used in https://github.com/RL4AA/rl4aa25-challenge 
The 3D models are sourced from [Cheetah](https://github.com/desy-ml/cheetah), which this project depends upon.
