"""低成本数值验收；不把合成输入当成模型质量或生产场景达标。"""
import json
from pathlib import Path
import tempfile
import unittest
import numpy as np
from PIL import Image
from infer import content_crop, prepare_images, load_checkpoint
from mesh import AXIS, world_points, grid_faces, rasterized_coverage, remove_duplicate_faces, reconstruct
from alignment import epipolar_distance, moving_correspondences
from pose_support import check_pair, projected, spatial_support


class ReconstructionTests(unittest.TestCase):
    def test_dense_local_object_is_not_whole_scene_support(self):
        x,y=np.meshgrid(np.linspace(300,325,10),np.linspace(225,240,8))
        a=np.column_stack([x.ravel(),y.ravel()])
        result=spatial_support(a,a+[90,30],[[640,480],[640,480]])
        self.assertEqual(result['count'],80)
        self.assertFalse(result['passed'])
        self.assertLess(result['views'][0]['imageCoverage'],.002)

    def test_distributed_depth_pose_passes_and_wrong_prediction_fails(self):
        h,w=480,640
        k=np.array([[480.,0,w/2],[0,480.,h/2],[0,0,1.]])
        y,x=np.meshgrid(np.linspace(40,440,8).astype(int),np.linspace(40,600,10).astype(int))
        a=np.column_stack([x.ravel(),y.ravel()]).astype(float)
        depth=np.ones((h,w))*3
        depth[y.ravel(),x.ravel()]=3+(np.arange(len(a))%7)*.17
        points=(np.column_stack([a,np.ones(len(a))])@np.linalg.inv(k).T)*depth[y.ravel(),x.ravel(),None]
        relative=np.eye(4);relative[:3,3]=[.2,.02,.05]
        b,_=projected(points,relative[:3,:3],relative[:3,3],k)
        result=check_pair(a,b,[[w,h],[w,h]],depth,[k,k],relative)
        self.assertTrue(result['accepted'],result)
        self.assertGreaterEqual(result['independentPoseFit']['heldOutInliers'],8)
        wrong=relative.copy();wrong[:3,3]=[-.8,.3,.1]
        result=check_pair(a,b,[[w,h],[w,h]],depth,[k,k],wrong)
        self.assertFalse(result['accepted'])
        self.assertTrue(result['independentPoseFit']['passed'])
        self.assertEqual(result['status'],'predicted-camera-mismatch')
        self.assertFalse(result['cameraModified'])

    def test_missing_alignment_never_exports_as_verified_geometry(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError,'缺少多图配准证据'):
                reconstruct(tmp)
            self.assertFalse((Path(tmp)/'reconstruction-scene.json').exists())

    def test_screen_fixed_marks_do_not_prove_camera_alignment(self):
        a=np.array([[5.,80.],[15.,90.],[70.,50.],[10.,10.]])
        b=np.array([[10.,160.],[30.1,180.],[110.,120.],[70.,60.]])
        aa,bb,removed=moving_correspondences(a,b,(100,100),(200,200))
        self.assertEqual(removed,2)
        np.testing.assert_array_equal(aa,a[2:]);np.testing.assert_array_equal(bb,b[2:])

    def test_camera_correspondence_check_rejects_wrong_pose(self):
        k=np.array([[800.,0,512],[0,800.,300],[0,0,1]])
        points=np.array([[-.9,-.4,3],[.2,.3,5],[1.,-.3,4],[-.2,.7,6]])
        project=lambda p:(p@k.T)[:,:2]/p[:,2:]
        a=project(points);b=project(points+np.array([.5,0,0]))
        skew=np.array([[0,0,0],[0,0,-.5],[0,.5,0]])
        f=np.linalg.inv(k).T@skew@np.linalg.inv(k)
        np.testing.assert_allclose(epipolar_distance(a,b,f),0,atol=1e-10)
        wrong=np.array([[0,0,.5],[0,0,0],[-.5,0,0]])
        self.assertGreater(np.median(epipolar_distance(a,b,np.linalg.inv(k).T@wrong@np.linalg.inv(k))),50)

    def test_shared_checkpoint_parameters_are_loaded_strictly(self):
        import torch
        from safetensors.torch import save_model, save_file
        with tempfile.TemporaryDirectory() as tmp:
            layer=torch.nn.Linear(2,2)
            model=torch.nn.ModuleList([layer,layer])
            wrapper=torch.nn.Module();wrapper.add_module("model",model)
            path=Path(tmp)/"weights.safetensors";save_model(wrapper,str(path))
            other=torch.nn.Linear(2,2);loaded=torch.nn.ModuleList([other,other])
            load_checkpoint(loaded,path)
            torch.testing.assert_close(loaded[1].weight,layer.weight)
            save_file({"model.0.weight":layer.weight},str(path))
            with self.assertRaises(RuntimeError):load_checkpoint(loaded,path)

    def test_camera_roundtrip_with_translation_and_rotation(self):
        depth=2+np.arange(63).reshape(7,9)*.003
        k=np.array([[12.,0,4.5],[0,11.,3.5],[0,0,1]])
        a=.31
        ext=np.array([[np.cos(a),0,np.sin(a),.8],[0,1,0,-.4],[-np.sin(a),0,np.cos(a),.2]])
        points,_=world_points(depth,k,ext)
        cam=points@ext[:,:3].T+ext[:,3]
        pixels=cam@k.T
        y,x=np.mgrid[:7,:9]
        np.testing.assert_allclose(pixels[...,:2]/pixels[...,2:],np.stack([x,y],-1),atol=1e-12)
        np.testing.assert_allclose(cam[...,2],depth,atol=1e-12)
        np.testing.assert_allclose(AXIS@AXIS.T,np.eye(3))
        self.assertAlmostEqual(np.linalg.det(AXIS),1.)

    def test_discontinuity_and_padding_are_not_bridged(self):
        depth=np.ones((5,7));depth[:,4:]=4
        mask=np.ones_like(depth,dtype=bool);mask[0]=False
        faces=grid_faces(depth,np.ones_like(depth),np.arange(5),np.arange(7),content_mask=mask)
        self.assertGreater(len(faces),0)
        self.assertTrue(mask.ravel()[faces].all())
        self.assertTrue((np.ptp(depth.ravel()[faces],axis=1)==0).all())

    def test_prior_holes_never_remove_later_surface(self):
        d=np.ones((6,8))*2;k=np.array([[10.,0,4],[0,10.,3],[0,0,1]])
        ext=np.eye(4)[:3]
        p,_=world_points(d,k,ext);p=p.reshape(-1,3)
        f=grid_faces(d,np.ones_like(d),np.arange(6),np.arange(8))
        y,x=np.mgrid[:6,:8]
        covered=rasterized_coverage(np.stack([x,y],-1).reshape(-1,2),f,d.shape)
        for mask,expected in [(covered,0),(np.zeros_like(covered),len(f))]:
            remaining,_=remove_duplicate_faces(p,f,1,np.stack([d,d]),np.stack([k,k]),np.stack([ext,ext]),[mask])
            self.assertEqual(len(remaining),expected)

    def test_mixed_aspect_images_preserve_whole_content(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            # 形状不同，四角颜色用来检出隐式居中裁剪。
            Image.new("RGB",(80,40),(200,30,10)).save(root/"wide.png")
            Image.new("RGB",(30,90),(10,200,30)).save(root/"tall.png")
            images,records=prepare_images([root/"wide.png",root/"tall.png"],root)
            self.assertEqual(images[0].size,images[1].size)
            self.assertEqual(records[1]["contentBox"],[0,0,30,90])
            x0,y0,x1,y1=records[1]["canvasContentBox"]
            self.assertEqual(images[1].getpixel((x0,y0)),(10,200,30))
            self.assertEqual(images[1].getpixel((x1-1,y1-1)),(10,200,30))
            self.assertEqual(images[1].getpixel((0,0)),(0,0,0))
        image=Image.new("RGB",(40,100),(40,40,40))
        image.paste((0,0,0),(0,0,40,5));image.paste((0,0,0),(0,94,40,100))
        _,box=content_crop(image)
        self.assertEqual(box,[0,5,40,94])

    def test_export_shared_world_scale_and_texture_tiles(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);h,w=24,40
            depths=np.full((2,h,w),2.)
            k=np.array([[32.,0,w/2],[0,32.,h/2],[0,0,1]])
            exts=np.repeat(np.eye(4)[None,:3],2,axis=0);exts[1,0,3]=-.5
            np.savez(root/"prediction.npz",depth=depths,depth_conf=np.ones_like(depths),intrinsics=np.stack([k,k]),extrinsics=exts)
            for i in range(2):Image.new("RGBA",(1200,720),(30+i*90,80,110,255)).save(root/f"reference-{i+1}.png")
            scene=reconstruct(root,diagnostic=True)
            self.assertEqual(len(scene["views"]),2)
            self.assertFalse(scene["metricScale"])
            self.assertTrue(scene['validation']['diagnostic'])
            self.assertFalse(scene['validation']['observedGeometryAccepted'])
            self.assertEqual(scene["sceneScale"],1.5)
            np.testing.assert_allclose(scene["views"][1]["position"],[.75,0,0])
            self.assertGreater(scene["statistics"][1]["consistentOverlapRemoved"],0)
            self.assertGreater(scene["statistics"][1]["triangles"],0)
            for mesh in scene["meshes"]:
                p=np.array(mesh["positions"]).reshape(-1,3)
                n=np.array(mesh["normals"]).reshape(-1,3)
                f=np.array(mesh["indices"]).reshape(-1,3)
                self.assertTrue(np.isfinite(p).all())
                self.assertLess(int(f.max()),len(p))
                np.testing.assert_allclose(np.linalg.norm(n,axis=1),1.,atol=1e-6)
                self.assertTrue((n[:,1]<0).all())
                tile=scene["surfaces"][mesh["material"]]
                self.assertLessEqual(max(tile["width"],tile["height"]),512)
                uv=np.array(mesh["uvs"])
                self.assertGreaterEqual(float(uv.min()),-.01)
                self.assertLessEqual(float(uv.max()),1.01)
            self.assertEqual(json.loads((root/"mesh-receipt.json").read_text())["views"],2)


if __name__=="__main__":
    unittest.main()
