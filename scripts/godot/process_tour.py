import os
import cv2

repo_root = os.path.abspath(".")
avi_path = os.path.join(repo_root, "godot", "recordings", "resident_lab_tour.avi")
if not os.path.exists(avi_path):
    avi_path = os.path.join(repo_root, "recordings", "resident_lab_tour.avi")

out_dir = os.path.join(repo_root, "godot", "recordings")
os.makedirs(out_dir, exist_ok=True)
mp4_path = os.path.join(out_dir, "resident_lab_tour.mp4")

print(f"Reading {avi_path}...")
cap = cv2.VideoCapture(avi_path)
fps = cap.get(cv2.CAP_PROP_FPS) or 60.0
total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
duration = total_frames / fps

print(f"Video info: {w}x{h} @ {fps:.1f} FPS, {total_frames} frames ({duration:.1f}s)")

# Keyframe timecodes (seconds) matching tour stages:
# Stage 1: t ~ 1.5s -> Game View Idle
# Stage 2: t ~ 4.5s -> Game View Walk (1.0x)
# Stage 3: t ~ 8.0s -> Front View Walk (1.0x)
# Stage 4: t ~ 11.5s -> Right Profile Walk (0.25x Slow-Motion)
# Stage 5: t ~ 16.0s -> Left Profile Walk (0.25x Slow-Motion)
# Stage 6: t ~ 20.5s -> Back View Walk (1.0x)
# Stage 7: t ~ 24.5s -> Carry Walk Profile (0.25x Slow-Motion)
# Stage 8: t ~ 28.5s -> Carry Walk Game View (1.0x)
# Stage 9: t ~ 32.5s -> Work Gather Clay (1.0x)
# Stage 10: t ~ 37.0s -> Night Campfire Illumination
keyframe_targets = {
    "tour_01_idle_game_view.png": int(1.5 * fps),
    "tour_02_walk_game_view.png": int(4.5 * fps),
    "tour_03_walk_front_view.png": int(8.0 * fps),
    "tour_04_walk_right_profile_slowmo.png": int(11.5 * fps),
    "tour_05_walk_left_profile_slowmo.png": int(16.0 * fps),
    "tour_06_walk_back_view.png": int(20.5 * fps),
    "tour_07_carry_walk_slowmo.png": int(24.5 * fps),
    "tour_08_carry_walk_game_view.png": int(28.5 * fps),
    "tour_09_work_gather.png": int(32.5 * fps),
    "tour_10_night_campfire.png": int(37.0 * fps)
}

# Video writer for MP4
fourcc = cv2.VideoWriter_fourcc(*'mp4v')
out = cv2.VideoWriter(mp4_path, fourcc, fps, (w, h))

frame_idx = 0
extracted_count = 0

while True:
    ret, frame = cap.read()
    if not ret:
        break

    out.write(frame)

    for filename, target_f in keyframe_targets.items():
        if frame_idx == target_f:
            snap_path = os.path.join(out_dir, filename)
            cv2.imwrite(snap_path, frame)
            print(f"Extracted keyframe {filename} at frame {frame_idx} (t={frame_idx/fps:.2f}s)")
            extracted_count += 1

    frame_idx += 1

cap.release()
out.release()

print(f"Saved MP4 to {mp4_path}")
print(f"Extracted {extracted_count} keyframe snapshots into {out_dir}")
