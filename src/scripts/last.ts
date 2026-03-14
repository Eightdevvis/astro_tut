

const allPosts = Object.values(import.meta.glob('../pages/posts/*.md', { eager: true }));


const lastPost = allPosts[allPosts.length -1];

function writePostOrder(postArr: Array<any>): void{
    console.log(postArr);
}

writePostOrder(allPosts);

export default lastPost; //is an object?