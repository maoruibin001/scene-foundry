import importlib.util, unittest, tempfile, hashlib
from pathlib import Path
import cv2, numpy as np
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('video_frames',Path(__file__).with_name('video-frames.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class VideoFramesTest(unittest.TestCase):
 def test_encoder_gap_uses_real_observed_pose_without_relaxing_250ms(self):
  class Capture:
   def __init__(self):self.index=-1;self.pts=[0,3500,7755,8999,12000,16000,19500,23000]
   def isOpened(self):return True
   def read(self):
    self.index+=1
    return (True,np.full((8,8,3),self.index*20,np.uint8)) if self.index<len(self.pts) else (False,None)
   def get(self,_):return self.pts[self.index]
   def release(self):pass
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);video=root/'gap.webm';video.write_bytes(b'original-video')
   targets=[{'name':f'continuous-{i+1}.png','timeMs':t} for i,t in enumerate([3500,8500,12000,16000,19500,23000])]
   # A real encoder stall skips the planned 8500ms frame. The actual 8999ms frame
   # must use the observed 9000ms pose, never the old 8500ms pose.
   with patch.object(module.cv2,'VideoCapture',side_effect=lambda _:Capture()):
    result=module.extract(video,root,targets,8,8,list(range(0,23100,100)))
   self.assertEqual(result['frames'][1]['requestedTimeMs'],8500)
   self.assertEqual(result['frames'][1]['observationTimeMs'],9000)
   self.assertEqual(result['frames'][1]['observationDeltaMs'],-1)
   with patch.object(module.cv2,'VideoCapture',side_effect=lambda _:Capture()):
    with self.assertRaisesRegex(ValueError,'250毫秒'):module.extract(video,root,targets,8,8,[0,3500,6000,12000,16000,19500,23000])
 def test_large_recording_hole_and_invalid_observations_still_fail(self):
  targets=[{'name':f'continuous-{i+1}.png','timeMs':i*1000} for i in range(4)]
  for obs in [[],[0,float('nan')],[0,0],[100,0]]:
   with self.assertRaisesRegex(ValueError,'观测时间'):module.extract(Path('unused'),Path('/tmp'),targets,8,8,obs)
  class Capture:
   index=-1
   def isOpened(self):return True
   def read(self):
    self.index+=1
    return (True,np.zeros((8,8,3),np.uint8)) if self.index<2 else (False,None)
   def get(self,_):return self.index*3000
   def release(self):pass
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);v=root/'hole.webm';v.write_bytes(b'hole')
   with patch.object(module.cv2,'VideoCapture',side_effect=lambda _:Capture()):
    with self.assertRaisesRegex(ValueError,'250毫秒'):module.extract(v,root,targets,8,8,list(range(0,3100,100)))
 def test_camera_transport_gap_selects_valid_pair_in_same_fixed_interval(self):
  targets=[{'name':f'continuous-{i+1}.png','timeMs':t} for i,t in enumerate([3500,7000,10500,14000,17500,21000])]
  timestamps=[0,3513,7013,10507,13997,16900,17467,19000,20999]
  observations=[100,3565,7084,10532,14030,16940,18950,21052]
  result=module.select_frames(timestamps,targets,observations)
  self.assertEqual(result[4]['videoTimeMs'],16900)
  self.assertEqual(result[4]['observationTimeMs'],16940)
  self.assertEqual(result[4]['requestedTimeMs'],17500)
  self.assertEqual(result[4]['observationDeltaMs'],-40)
  self.assertEqual(len({r['observationIndex'] for r in result}),6)
 def test_missing_pairs_preserve_original_measurements_but_never_write_fake_frames(self):
  class Capture:
   def __init__(self):self.index=-1
   def isOpened(self):return True
   def read(self):
    self.index+=1
    return (True,np.zeros((8,8,3),np.uint8)) if self.index<2 else (False,None)
   def get(self,_):return self.index*3000
   def release(self):pass
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);v=root/'hole.webm';v.write_bytes(b'real-but-incomplete-video')
   targets=[{'name':f'continuous-{i+1}.png','timeMs':i*1000} for i in range(4)]
   with patch.object(module.cv2,'VideoCapture',side_effect=lambda _:Capture()):
    result=module.extract(v,root,targets,8,8,list(range(0,3100,100)),preserve_incomplete=True)
   self.assertEqual(result['status'],'incomplete');self.assertEqual(result['frames'],[])
   self.assertEqual(result['decodedFrames'],2);self.assertEqual(result['durationMs'],3000)
   self.assertEqual(result['videoSha256'],hashlib.sha256(v.read_bytes()).hexdigest())
   self.assertEqual(result['issue']['code'],'VIDEO_POSE_COVERAGE');self.assertEqual(list(root.glob('*.png')),[])
   # The relaxed exit contract does not relax input/source validation.
   with patch.object(module.cv2,'VideoCapture',side_effect=lambda _:Capture()):
    with self.assertRaisesRegex(ValueError,'尺寸'):module.extract(v,root,targets,16,16,list(range(0,3100,100)),preserve_incomplete=True)
 def test_decode_pts_and_reject_missing_tail(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);video=root/'source.avi';writer=cv2.VideoWriter(str(video),cv2.VideoWriter_fourcc(*'MJPG'),10,(1600,900));self.assertTrue(writer.isOpened())
   for i in range(8):
    frame=np.zeros((900,1600,3),np.uint8);frame[:,:,1]=i*25;frame[:,i*100:i*100+200,2]=255;writer.write(frame)
   writer.release();targets=[{'name':f'continuous-{i+1}.png','timeMs':i*100} for i in range(4)]
   result=module.extract(video,root,targets);self.assertEqual(result['decodedFrames'],8);self.assertEqual(result['videoSha256'],hashlib.sha256(video.read_bytes()).hexdigest());self.assertEqual([f['frameIndex'] for f in result['frames']],[0,1,2,3])
   for f in result['frames']:self.assertEqual(f['sha256'],hashlib.sha256((root/f['name']).read_bytes()).hexdigest())
   with self.assertRaisesRegex(ValueError,'250毫秒'):module.extract(video,root,[*targets[:3],{'name':'continuous-4.png','timeMs':1500}])
 def test_portrait_pts_preserves_pixels_and_rejects_wrong_declared_size(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);video=root/'portrait.avi';writer=cv2.VideoWriter(str(video),cv2.VideoWriter_fourcc(*'MJPG'),10,(320,480));self.assertTrue(writer.isOpened())
   for i in range(6): writer.write(np.full((480,320,3),i*30,np.uint8))
   writer.release();targets=[{'name':f'continuous-{i+1}.png','timeMs':i*100} for i in range(4)]
   result=module.extract(video,root,targets,320,480)
   self.assertEqual(cv2.imread(str(root/result['frames'][0]['name'])).shape[:2],(480,320))
   with self.assertRaisesRegex(ValueError,'尺寸'): module.extract(video,root,targets,1600,900)
 def test_reject_bad_targets_before_opening_video(self):
  targets=[{'name':f'continuous-{i+1}.png','timeMs':i*100} for i in range(4)];targets[0]['name']='../outside.png'
  with self.assertRaisesRegex(ValueError,'无效'):module.extract(Path('missing.webm'),Path('/tmp'),targets)
  targets[0]['name']='continuous-1.png';targets[1]['timeMs']=0
  with self.assertRaisesRegex(ValueError,'递增'):module.extract(Path('missing.webm'),Path('/tmp'),targets)
if __name__=='__main__':unittest.main()
