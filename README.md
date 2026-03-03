# Cheetah 3D Visualization

This repository contains a Python-based simulation control system and a JavaScript-based 3D visualization application for a particle beam lattice. Follow the instructions below to set up the environment and dependencies.

## Prerequisites
- Python 3.10+

## Install
`pip install -e .`

## Running
Define a beam factory function that returns a new instance of a `cheetah.ParticleBeam`
```
def beam_factory(num_particles:int) -> cheetah.ParticleBeam:
    return cheetah.ParticleBeam.from_twiss(
            num_particles=num_particles,
            ...
        )
```

Pass the factory function and your lattice json to the `CheetahGym` constructor and start the server:

```
import CheetahVis

vis = CheetahVis.CheetahVis("my_cheetah_lattice.json", beam_factory)
vis.reset()

# Create the background web and websocket servers
asyncio.run(vis.start_server())

```

## Development
To run the web app in development mode, set `NODE_ENV=development` in the `.env` file. You will then need to run `npm vite` 

## Acknowledgements
This code is substantial reworking of the 3D visualisation used in https://github.com/RL4AA/rl4aa25-challenge 
The 3D models are sourced from [Cheetah](https://github.com/desy-ml/cheetah), which this project depends upon.