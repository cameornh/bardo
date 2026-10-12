import trimesh
import numpy as np
import json
import math

def get_quaternion_from_normal(normal):
    """
    Math magic: Converts a surface normal vector into a 3D rotation (quaternion).
    This ensures our flat Gaussian Splat lays perfectly flat on the object's surface.
    """
    up = np.array([0.0, 0.0, 1.0]) # Default splat faces UP (Z-axis)
    
    # If the normal is already pointing up or down, handle it to avoid math errors
    if np.allclose(normal, up):
        return[1.0, 0.0, 0.0, 0.0] # W, X, Y, Z
    elif np.allclose(normal, -up):
        return[0.0, 1.0, 0.0, 0.0]
        
    axis = np.cross(up, normal)
    axis_length = np.linalg.norm(axis)
    axis /= axis_length
    
    angle = np.arccos(np.dot(up, normal))
    
    # Convert Axis-Angle to Quaternion (W, X, Y, Z)
    sin_half = math.sin(angle / 2.0)
    return[
        math.cos(angle / 2.0), # W
        axis[0] * sin_half,    # X
        axis[1] * sin_half,    # Y
        axis[2] * sin_half     # Z
    ]

def generate_splats(mesh_path, num_points=10000):
    print(f"Loading mesh: {mesh_path}")
    mesh = trimesh.load(mesh_path, force='mesh')
    
    print(f"Sampling {num_points} points on the surface...")
    # Trimesh magically samples points evenly across the surface area
    points, face_indices = trimesh.sample.sample_surface(mesh, num_points)
    
    # Get the normals (facing direction) of the faces those points landed on
    normals = mesh.face_normals[face_indices]
    
    # Calculate how big each splat should be to cover the surface seamlessly
    surface_area = mesh.area
    area_per_splat = surface_area / num_points
    radius = math.sqrt(area_per_splat / math.pi) * 1.5 # 1.5 overlap factor to avoid holes
    
    splats =[]
    
    print("Converting points to Gaussian Splats...")
    for i in range(num_points):
        pos = points[i]
        norm = normals[i]
        
        # 1. Position
        position = {"x": float(pos[0]), "y": float(pos[1]), "z": float(pos[2])}
        
        # 2. Normal (Store this! You will need it for Phase 2 dynamic lighting)
        normal = {"x": float(norm[0]), "y": float(norm[1]), "z": float(norm[2])}
        
        # 3. Rotation (Align to the normal)
        quat = get_quaternion_from_normal(norm)
        rotation = {"w": float(quat[0]), "x": float(quat[1]), "y": float(quat[2]), "z": float(quat[3])}
        
        # 4. Scale (X and Y are the radius, Z is thickness. Make Z very thin for hollow surface splats)
        scale = {"x": float(radius), "y": float(radius), "z": float(radius * 0.1)}
        
        # 5. Color (Let's make it a nice grey-blue for now)
        color = {"r": 100, "g": 150, "b": 200, "a": 255}
        
        splats.append({
            "id": i,
            "position": position,
            "normal": normal,
            "rotation": rotation,
            "scale": scale,
            "color": color
        })
        
    return splats

# --- RUN THE SCRIPT ---
if __name__ == "__main__":
    # Create a primitive box using trimesh just to test
    test_mesh = trimesh.creation.box(extents=(2, 2, 2))
    test_mesh.export("test_cube.obj") # Save it to disk so we simulate loading an asset
    
    # Generate the splats
    splat_data = generate_splats("test_cube.obj", num_points=15000)
    
    # Save to JSON
    output_filename = "synthetic_splats.json"
    with open(output_filename, "w") as f:
        json.dump(splat_data, f, indent=2)
        
    print(f"Success! Generated {len(splat_data)} splats and saved to {output_filename}")