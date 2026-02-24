# Cheetah 3D Visualization

This repository contains a Python-based simulation control system and a JavaScript-based 3D visualization application for a particle beam lattice. Follow the instructions below to set up the environment and dependencies.

## Prerequisites
- Python
- Nodejs

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
gym = CheetahGym("my_cheetah_lattice.json", beam_factory)
gym.reset()

# Create the background simulation task and web host
simulation_task = await asyncio.create_task(gym.start_server())

await asyncio.sleep(1)
print("OK")
```

## Development
To run the web app in development mode, set `NODE_ENV=development` in the `.env` file

## Acknowledgements
This code is substantial reworking of the 3D visualisation used in https://github.com/RL4AA/rl4aa25-challenge 
The 3D models are sourced from [Cheetah](https://github.com/desy-ml/cheetah), which this project depends upon.