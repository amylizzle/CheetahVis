import CheetahVis
import cheetah
import torch
import asyncio

doing_init = True

# TODO: particle beam from the injector could be different
def beam_factory(num_particles:int) -> cheetah.ParticleBeam:
    return cheetah.ParticleBeam.from_twiss(
            num_particles=num_particles,
            alpha_x=torch.tensor(-0.949),
            beta_x=torch.tensor(14.236),
            emittance_x=torch.tensor(3.29e-9),
            emittance_y=torch.tensor(4.20e-9),
            alpha_y=torch.tensor(72.003),
            beta_y=torch.tensor(925.297),
            sigma_p=torch.tensor(0.01),
            energy=torch.tensor(250e6),
            total_charge=torch.tensor(10e-12),
        )

vis = CheetahVis.CheetahVis("FEBE_full.json", beam_factory)
vis.reset()

asyncio.run(vis.start_server())

