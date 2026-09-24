import importlib.util, unittest, tempfile, hashlib
from pathlib import Path
import cv2, numpy as np
spec=importlib.util.spec_from_file_location('video_frames',Path(__file__).with_name('video-frames.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class VideoFramesTest(unittest.TestCase):
 def test_decode_pts_and_reject_missing_tail(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);video=root/'source.avi';writer=cv2.VideoWriter(str(video),cv2.VideoWriter_fourcc(*'MJPG'),10,(1600,900));self.assertTrue(writer.isOpened())
   for i in range(8):
    frame=np.zeros((900,1600,3),np.uint8);frame[:,:,1]=i*25;frame[:,i*100:i*100+200,2]=255;writer.write(frame)
   writer.release();targets=[{'name':f'continuous-{i+1}.png','timeMs':i*100} for i in range(4)]
   result=module.extract(video,root,targets);self.assertEqual(result['decodedFrames'],8);self.assertEqual(result['videoSha256'],hashlib.sha256(video.read_bytes()).hexdigest());self.assertEqual([f['frameIndex'] for f in result['frames']],[0,1,2,3])
   for f in result['frames']:self.assertEqual(f['sha256'],hashlib.sha256((root/f['name']).read_bytes()).hexdigest())
   with self.assertRaisesRegex(ValueError,'250毫秒'):module.extract(video,root,[*targets[:3],{'name':'continuous-4.png','timeMs':1500}])
 def test_reject_bad_targets_before_opening_video(self):
  targets=[{'name':f'continuous-{i+1}.png','timeMs':i*100} for i in range(4)];targets[0]['name']='../outside.png'
  with self.assertRaisesRegex(ValueError,'无效'):module.extract(Path('missing.webm'),Path('/tmp'),targets)
  targets[0]['name']='continuous-1.png';targets[1]['timeMs']=0
  with self.assertRaisesRegex(ValueError,'递增'):module.extract(Path('missing.webm'),Path('/tmp'),targets)
if __name__=='__main__':unittest.main()
