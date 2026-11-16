import {collisionProxy} from './collision.js';
self.onmessage=({data})=>{try{self.postMessage({proxy:collisionProxy(data)});}catch(e){self.postMessage({error:e.message});}};
