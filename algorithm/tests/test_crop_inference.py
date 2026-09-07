import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))
from algorithm.crop_inference import infer_crop_type

def test_explicit_osm_tag():
    print("\n--- Test: Explicit OSM Tag ---")
    res = infer_crop_type({'crop': 'wheat'}, 30.0, 75.0)
    print(res)
    assert 'Wheat (OSM Confirmed)' in res
    assert res['Wheat (OSM Confirmed)'] == 100.0

def test_punjab_heuristic():
    print("\n--- Test: Punjab Heuristic ---")
    res = infer_crop_type({}, 30.0, 75.0)
    print(res)
    assert 'Wheat' in res
    assert res['Wheat'] == 65.0

def test_south_india_heuristic():
    print("\n--- Test: South India Heuristic ---")
    res = infer_crop_type({'landuse': 'farmland'}, 11.0, 77.0)
    print(res)
    assert 'Rice Paddy' in res

if __name__ == "__main__":
    test_explicit_osm_tag()
    test_punjab_heuristic()
    test_south_india_heuristic()
    print("\nAll crop inference tests passed!")
