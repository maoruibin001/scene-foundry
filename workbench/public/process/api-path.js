export const apiPath=path=>globalThis.location?.pathname.startsWith('/voxel/')&&path.startsWith('/api/')?path.replace('/api/','/api/voxel/'):path;
