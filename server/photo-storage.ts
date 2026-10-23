export const accountPhotoPrefix=(accountId:string)=>`accounts/${encodeURIComponent(accountId)}/dog-photos/`;
export const accountPhotoKey=(accountId:string,photoId:string)=>accountPhotoPrefix(accountId)+photoId+'.jpg';
export async function deleteAccountPhotos(bucket:R2Bucket,accountId:string):Promise<void> {
  const prefix=accountPhotoPrefix(accountId);
  for(;;){
    const page=await bucket.list({prefix,limit:1000});
    if(!page.objects.length)return;
    await bucket.delete(page.objects.map(object=>object.key));
  }
}
