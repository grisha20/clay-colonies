extends SceneTree
func _initialize() -> void:
    call_deferred("run")
func run() -> void:
    SurfaceTerrain.set_terrain({"seed": 999, "lakes": [], "mountains": [], "hills": [{"x":120.0,"y":236.0,"radius":40.0,"height":5.0}]})
    var scene: WorldObserver = load("res://scenes/game/world_observer.tscn").instantiate()
    root.add_child(scene)
    scene.world_view.camera_pivot.position = Vector3(120,4,236)
    for i in range(3):
        await process_frame
    var expected = Vector2(120,236)
    var screen = scene.world_view.camera.unproject_position(Vector3(120,SurfaceTerrain.height_at(120,236),236))
    var picked = scene.ground_point_at(screen)
    print("HILL_PICK height=",SurfaceTerrain.height_at(120,236)," expected=",expected," picked=",picked," error=",expected.distance_to(picked))
    scene.free()
    await process_frame
    quit(0)

