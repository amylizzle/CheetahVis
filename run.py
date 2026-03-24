from CATAP.magnet import MagnetFactory
import CheetahVis
import cheetah
import torch
import asyncio
import requests
import traceback

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

def update_element(vishandle: CheetahVis.CheetahVis, element: cheetah.Element, varname: str, value: float, pv_name: str):
    # use requests to get http://dsastvx10.dl.ac.uk:8001/magnet/convert for I to K
    # http://dsastvx10.dl.ac.uk:8001/docs#/default/convert_magnet_parameters_magnet_convert_post
    print(f"updating {element.name} to value {value}")
    #print({"current":value, "magnet_name":pv_name, "momentum":250})
    if ":SETI" in pv_name:
        pv_name = pv_name[:-5]
    try:
        resp = requests.post(url="http://dsastvx10.dl.ac.uk:8001/magnet/convert", json={"current":value, "magnet_name":pv_name, "momentum":250})
        if resp.ok:
            data = resp.json()
            # print(data)
            setattr(element, varname, torch.tensor(float(data["K"])))
            if not doing_init:
                vishandle.step(None)
                asyncio.run_coroutine_threadsafe(vishandle.render(), vishandle.asyncio_loop)
        else:
            print(f"Bad response requesting {pv_name} from converter")
    except Exception as E:
        traceback.print_exc()


if __name__ == '__main__':
    magnets = MagnetFactory(is_virtual=False)
    vis = CheetahVis.CheetahVis("FEBE_full.json", beam_factory)
    vis.reset()

    for name, magnet in magnets.hardware.items():
        cheetah_name = name.lower().replace("-", "_")
        magtype = None
        if "vcor" in cheetah_name:
            if not cheetah_name in vis.segment.element_names:
                cheetah_name = cheetah_name.replace("vcor", "hvcor")
                magtype = "hvcor_v"
            else:
                magtype = "vcor"
        elif "hcor" in cheetah_name and not cheetah_name in vis.segment.element_names:
            if not cheetah_name in vis.segment.element_names:
                cheetah_name = cheetah_name.replace("hcor", "hvcor")
                magtype = "hvcor_h"
            else:
                magtype = "hcor"            
        elif "quad" in cheetah_name:
            magtype = "quad"
        elif "dip" in cheetah_name:
            magtype = "dipole"
        
        
        if cheetah_name in vis.segment.element_names:
            #print(f"Connecting magnet {name} to Cheetah element {cheetah_name}")
            element = vis.segment.elements[vis.segment.element_index(cheetah_name)]
            # TODO: current -> field conversion for dipoles and quads, and angle conversion for correctors
            if True:#magnet.seti is None:
                print(f"catap gave none for {name}, skipping")
                continue
            if magtype == "vcor":
                update_element(vis, element, "angle", magnet.seti, name+":SETI")
                magnet.controls_information.pv_record_map.SETI._pv.add_callback(lambda value, pvname, **kw: update_element(vis, element, "angle", value, pvname))
            elif magtype == "hcor":
                update_element(vis, element, "angle", magnet.seti, name)
                magnet.controls_information.pv_record_map.SETI._pv.add_callback(lambda value, pvname, **kw: update_element(vis, element, "angle", value, pvname))                
            elif magtype == "hvcor_v":
                update_element(vis, element, "vertical_angle", magnet.seti, name)
                magnet.controls_information.pv_record_map.SETI._pv.add_callback(lambda value, pvname, **kw: update_element(vis, element, "vertical_angle", value, pvname))
            elif magtype == "hvcor_h":
                update_element(vis, element, "horizontal_angle", magnet.seti, name)
                magnet.controls_information.pv_record_map.SETI._pv.add_callback(lambda value, pvname, **kw: update_element(vis, element, "horizontal_angle", value, pvname))
            elif magtype == "quad":
                update_element(vis, element, "k1", magnet.seti, name)
                magnet.controls_information.pv_record_map.SETI._pv.add_callback(lambda value, pvname, **kw: update_element(vis, element, "k1", value, pvname))
            elif magtype == "dipole":
                update_element(vis, element, "k1", magnet.seti, name)
                magnet.controls_information.pv_record_map.SETI._pv.add_callback(lambda value, pvname, **kw: update_element(vis, element, "k1", value, pvname))
            else:
                print(f"Warning: Magnet {name} has an unrecognized type and will be connected as a quadrupole by default.")
                update_element(vis, element, "k1", magnet.seti, name)
                magnet.controls_information.pv_record_map.SETI._pv.add_callback(lambda value, pvname, **kw: update_element(vis, element, "k1", value, pvname))
        else:
            print(f"Warning: Magnet {name} does not have a corresponding Cheetah element.")

    doing_init = False
    asyncio.run(vis.start_server())

