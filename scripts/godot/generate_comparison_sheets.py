import os
import cv2
import numpy as np

repo_root = os.path.abspath(".")
rec_dir = os.path.join(repo_root, "godot", "recordings")
before_dir = os.path.join(rec_dir, "before_c02938a")
comp_dir = os.path.join(rec_dir, "comparisons")
os.makedirs(comp_dir, exist_ok=True)

def create_side_by_side(before_img, after_img, title, crop_box=None):
    if crop_box:
        # crop_box = (ymin, ymax, xmin, xmax) in normalized [0, 1]
        h, w = before_img.shape[:2]
        y1, y2 = int(crop_box[0] * h), int(crop_box[1] * h)
        x1, x2 = int(crop_box[2] * w), int(crop_box[3] * w)
        b_crop = before_img[y1:y2, x1:x2]
        a_crop = after_img[y1:y2, x1:x2]
    else:
        b_crop = before_img
        a_crop = after_img

    # Resize so both have same height
    h_target = 720
    w_b = int(b_crop.shape[1] * (h_target / b_crop.shape[0]))
    w_a = int(a_crop.shape[1] * (h_target / a_crop.shape[0]))
    b_res = cv2.resize(b_crop, (w_b, h_target))
    a_res = cv2.resize(a_crop, (w_a, h_target))

    # Header bar
    header_h = 70
    total_w = w_b + w_a + 20 # 20px divider
    canvas = np.zeros((h_target + header_h, total_w, 3), dtype=np.uint8)
    canvas[:] = (32, 30, 28) # dark background

    # Title
    cv2.putText(canvas, title, (20, 36), cv2.FONT_HERSHEY_DUPLEX, 0.9, (230, 230, 230), 2, cv2.LINE_AA)
    cv2.putText(canvas, "BEFORE: c02938a (Technical assembly)", (20, header_h - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (160, 160, 240), 1, cv2.LINE_AA)
    cv2.putText(canvas, "AFTER: Current (Organic Terracotta M1)", (w_b + 30, header_h - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (100, 220, 140), 2, cv2.LINE_AA)

    # Place images
    canvas[header_h:header_h + h_target, 0:w_b] = b_res
    canvas[header_h:header_h + h_target, w_b + 20:w_b + 20 + w_a] = a_res

    # Divider line
    canvas[header_h:header_h + h_target, w_b + 9:w_b + 11] = (100, 100, 100)

    return canvas

# 1. Wide Camp Game View
b_camp = cv2.imread(os.path.join(before_dir, "tour_01_idle_game_view.png"))
a_camp = cv2.imread(os.path.join(rec_dir, "tour_01_idle_game_view.png"))
if b_camp is not None and a_camp is not None:
    comp1 = create_side_by_side(b_camp, a_camp, "CLAYFOLK CAMP & ENVIRONMENT (58 deg GAME VIEW)")
    cv2.imwrite(os.path.join(comp_dir, "comparison_01_camp_view.png"), comp1)
    print("Created comparison_01_camp_view.png")

# 2. Character Front View (Full Figure)
b_front = cv2.imread(os.path.join(before_dir, "tour_03_walk_front_view.png"))
a_front = cv2.imread(os.path.join(rec_dir, "tour_03_walk_front_view.png"))
if b_front is not None and a_front is not None:
    comp2 = create_side_by_side(b_front, a_front, "RESIDENT FULL FIGURE (FRONT VIEW)")
    cv2.imwrite(os.path.join(comp_dir, "comparison_02_character_front.png"), comp2)
    print("Created comparison_02_character_front.png")

# 3. Character Profile View (Full Figure & Feet Grounding)
b_prof = cv2.imread(os.path.join(before_dir, "tour_05_walk_left_profile.png"))
a_prof = cv2.imread(os.path.join(rec_dir, "tour_05_walk_left_profile_slowmo.png"))
if b_prof is not None and a_prof is not None:
    comp3 = create_side_by_side(b_prof, a_prof, "RESIDENT PROFILE & FOOT GROUNDING (LEFT PROFILE)")
    cv2.imwrite(os.path.join(comp_dir, "comparison_03_character_profile.png"), comp3)
    print("Created comparison_03_character_profile.png")

# 4. Night Campfire Illumination
b_night = cv2.imread(os.path.join(before_dir, "tour_09_night_campfire.png"))
a_night = cv2.imread(os.path.join(rec_dir, "tour_10_night_campfire.png"))
if b_night is not None and a_night is not None:
    comp4 = create_side_by_side(b_night, a_night, "CAMPFIRE ILLUMINATION & FLAME GEOMETRY (NIGHT VIEW)")
    cv2.imwrite(os.path.join(comp_dir, "comparison_04_night_campfire.png"), comp4)
    print("Created comparison_04_night_campfire.png")

# 5. Close-up details: Waist knot and Head / Face
if b_front is not None and a_front is not None:
    # Crop central torso/head/waist
    crop_waist = (0.25, 0.85, 0.35, 0.65)
    comp5 = create_side_by_side(b_front, a_front, "CLOSE-UP DETAILS: HEAD, FACE & BRAIDED WAIST CORD", crop_box=crop_waist)
    cv2.imwrite(os.path.join(comp_dir, "comparison_05_details_closeup.png"), comp5)
    print("Created comparison_05_details_closeup.png")

print(f"All comparison sheets saved in {comp_dir}")
