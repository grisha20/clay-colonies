"""Small shared clay building kit: rounded geometry, one opaque 1024 atlas.

Straw deliberately has isotropic clay mottling, never longitudinal wood grain.
All units are game metres; Blender -Y is the front (+Z after glTF export).
"""
from pathlib import Path
import math
import json
import bpy
import bmesh
import numpy as np
from mathutils import Vector
from generate_hut import png

ROOT=Path(__file__).resolve().parents[3]
SOURCE=ROOT/'art/blender/buildings'
EXPORT=ROOT/'godot/assets/models/buildings'
TAU=math.tau


def palette():
    colors=[(211,111,53),(230,169,85),(220,155,72),(236,181,103),
            (123,72,38),(53,29,18),(180,80,40),(183,120,64),
            (146,145,135),(169,164,149),(100,58,30),(73,40,22),
            (74,145,151),(168,75,41),(208,178,127),(234,210,170)]
    rng=np.random.default_rng(98132)
    image=np.zeros((1024,1024,3),dtype=np.uint8)
    y,x=np.mgrid[0:256,0:256]/256
    for i,color in enumerate(colors):
        # Soft isotropic mottling and clay dimples, not a directional fibre map.
        noise=rng.normal(0,.006,(256,256))
        for j in range(70):
            cx,cy=rng.uniform(0,1,2);r=rng.uniform(.006,.05)
            noise+=rng.uniform(-.04,.025)*np.exp(-((x-cx)**2+(y-cy)**2)/r**2)
        if i in (4,10,11):noise+=.04*np.sin(x*42+np.sin(y*13)*2)
        if i==7:noise+=.035*np.sin(np.sqrt((x-.5)**2+(y-.5)**2)*125)
        image[(i//4)*256:(i//4+1)*256,(i%4)*256:(i%4+1)*256]=np.clip(np.array(color)*(1+noise[:,:,None]),0,255).astype(np.uint8)
    EXPORT.mkdir(parents=True,exist_ok=True)
    path=EXPORT/'buildings_v2_palette.png';png(path,image)
    return path


class Builder:
    def __init__(self,name):
        self.name=name;self.vertices=[];self.faces=[];self.uv=[]

    def add(self,vertices,faces,tile,uv=None):
        start=len(self.vertices);self.vertices.extend(tuple(p) for p in vertices)
        self.faces.extend(tuple(start+i for i in face) for face in faces)
        if uv is None:uv=[((p[0]*.19)%1,(p[2]*.23)%1) for p in vertices]
        self.uv.extend(((tile%4+.08+.84*u)/4,(3-tile//4+.08+.84*v)/4) for u,v in uv)

    def tube(self,points,radii,tile,sides=6,across=None):
        points=[Vector(p) for p in points];vertices=[];faces=[];uv=[];rings=[]
        for i,(p,radius) in enumerate(zip(points,radii)):
            tangent=(points[min(i+1,len(points)-1)]-points[max(0,i-1)]).normalized()
            hint=Vector(across) if across is not None else (Vector((1,0,0)) if abs(tangent.x)<.85 else Vector((0,1,0)))
            u=(hint-tangent*hint.dot(tangent)).normalized();v=tangent.cross(u).normalized()
            rx,ry=(radius,radius) if isinstance(radius,(int,float)) else radius
            ring=[]
            for side in range(1 if rx==0 else sides):
                a=TAU*side/sides
                ring.append(len(vertices));vertices.append(p+u*math.cos(a)*rx+v*math.sin(a)*ry)
                uv.append((side/sides,i/(len(points)-1)))
            rings.append(ring)
        for a,b in zip(rings,rings[1:]):
            for i in range(sides):
                j=(i+1)%sides
                if len(a)==1:faces.append((a[0],b[j],b[i]))
                elif len(b)==1:faces.append((a[i],a[j],b[0]))
                else:faces.append((a[i],a[j],b[j],b[i]))
        if len(rings[0])>1:faces.append(tuple(reversed(rings[0])))
        if len(rings[-1])>1:faces.append(tuple(rings[-1]))
        self.add(vertices,faces,tile,uv)

    def beam(self,a,b,radius=.13,tile=4,sides=6):
        a=Vector(a);b=Vector(b)
        self.tube([a,a.lerp(b,.5),b],[radius*.94,radius,radius*.94],tile,sides)

    def box(self,center,size,tile=15):
        x,y,z=[s*.5 for s in size];c=Vector(center)
        vertices=[c+Vector(p) for p in [(-x,-y,-z),(x,-y,-z),(x,y,-z),(-x,y,-z),(-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)]]
        self.add(vertices,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],tile)

    def lump(self,center,scale,tile=8,sides=8):
        c=Vector(center);sx,sy,sz=scale
        vertices=[c+Vector((0,0,-sz)),c+Vector((0,0,sz))];uv=[(.5,0),(.5,1)]
        for z,r in [(-.42,.88),(.42,.88)]:
            for i in range(sides):
                a=TAU*i/sides
                vertices.append(c+Vector((math.cos(a)*sx*r,math.sin(a)*sy*r,z*sz)));uv.append((i/sides,(z+1)*.5))
        faces=[]
        for i in range(sides):
            j=(i+1)%sides
            faces.extend([(0,2+j,2+i),(2+i,2+j,2+sides+j,2+sides+i),(1,2+sides+i,2+sides+j)])
        self.add(vertices,faces,tile,uv)

    def straw(self,points,half_width,seed,tile=1):
        rng=np.random.default_rng(seed)
        a,m,b=[Vector(p) for p in points]
        # Three plump rings with hemispherical tips; the middle is deliberately
        # lumpy and each bundle has slightly different thickness and droop.
        p1=a.lerp(m,.21);p2=m+Vector((0,0,rng.uniform(-.02,.025)));p3=m.lerp(b,.82)
        self.tube([a,p1,p2,p3,b],[0,(half_width*.77,half_width*.71),
            (half_width*rng.uniform(.98,1.1),half_width*.90),(half_width*.77,half_width*.71),0],tile,5)

    def round_roof(self,rx,ry,z_top,z_edge,count,seed):
        for i in range(count):
            a=TAU*(i+.5)/count
            c,s=math.cos(a),math.sin(a)
            width=math.sqrt((rx*s)**2+(ry*c)**2)*math.pi/count*1.04
            points=[(c*.22,s*.15,z_top),(c*rx*.61,s*ry*.61,(z_top+z_edge)*.5+.07),
                    (c*rx,s*ry,z_edge-.025*math.sin(i*2.1))]
            self.straw(points,width,seed+i,1+(i%7==0)+(i%11==0))
        # Continuous inner roof, hidden by the rolls and filling their seams.
        vertices=[(0,0,z_top-.05)]+[(rx*.96*math.cos(TAU*i/24),ry*.96*math.sin(TAU*i/24),z_edge-.05) for i in range(24)]
        self.add(vertices,[(0,i+1,(i+1)%24+1) for i in range(24)],2)

    def pitched_roof(self,half_x,half_y,eave,ridge,count=12,seed=0):
        for sign in (-1,1):
            for row in (0,1):
                for i in range(count):
                    x=-half_x+(i+.5)*2*half_x/count
                    t0=0 if row==0 else .40;t1=.61 if row==0 else 1
                    def p(t):return (x,sign*half_y*t,ridge+(eave-ridge)*t+.025*math.sin(i*1.7))
                    self.straw([p(t0),p((t0+t1)*.5),p(t1)],half_x/count*1.03,seed+row*100+i,1+(i%9==0))
        self.add([(-half_x,0,ridge-.07),(half_x,0,ridge-.07),(-half_x,-half_y,eave-.07),(half_x,-half_y,eave-.07),(-half_x,half_y,eave-.07),(half_x,half_y,eave-.07)],[(0,2,3,1),(0,1,5,4)],2)

    def object(self,atlas,offset=.6):
        mesh=bpy.data.meshes.new(self.name+'Mesh')
        vertices=[(x,y-offset,z) for x,y,z in self.vertices]
        mesh.from_pydata(vertices,[],self.faces);mesh.update()
        uv=mesh.uv_layers.new(name='PaletteUV')
        for face in mesh.polygons:
            for loop in face.loop_indices:uv.data[loop].uv=self.uv[mesh.loops[loop].vertex_index]
        bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free()
        for face in mesh.polygons:face.use_smooth=True
        obj=bpy.data.objects.new(self.name,mesh);bpy.context.collection.objects.link(obj)
        mat=bpy.data.materials.get('BuildingClayAtlas')
        if mat is None:
            mat=bpy.data.materials.new('BuildingClayAtlas');mat.use_nodes=True
            shader=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
            shader.inputs['Roughness'].default_value=.90;shader.inputs['Specular IOR Level'].default_value=.20
            image=bpy.data.images.load(str(atlas));image.name='buildings_v2_palette';image.pack()
            tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image
            mat.node_tree.links.new(tex.outputs['Color'],shader.inputs['Base Color'])
        mesh.materials.append(mat)
        obj['Reference']='art/hud/build_'+self.name.replace('V2','').lower()+'.png'
        return obj


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version=0


def export(name,objects,footprint,height_range):
    bpy.ops.object.select_all(action='DESELECT')
    vertices=[];triangles=0
    for obj in objects:
        obj.select_set(True)
        triangles+=sum(len(p.vertices)-2 for p in obj.data.polygons)
        vertices.extend(tuple(obj.matrix_world@v.co) for v in obj.data.vertices)
    points=np.array(vertices);low=points.min(axis=0);high=points.max(axis=0)
    rx,ry,offset=footprint
    ellipse=(points[:,0]/rx)**2+((points[:,1]+offset)/ry)**2
    assert triangles<=3000,(name,triangles)
    assert ellipse.max()<=1,(name,'footprint',ellipse.max())
    assert height_range[0]<=high[2]-low[2]<=height_range[1],(name,'height',high-low)
    SOURCE.mkdir(parents=True,exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/(name+'_v2.blend')))
    bpy.ops.export_scene.gltf(filepath=str(EXPORT/(name+'_v2.glb')),export_format='GLB',use_selection=True,export_animations=False,export_extras=True)
    print('BUILDING_V2_BUDGET '+json.dumps({'name':name,'triangles':triangles,'size':[float(high[0]-low[0]),float(high[2]-low[2]),float(high[1]-low[1])],'ellipse_max':float(ellipse.max())}))
