/** The dev proxy must use the socket address; forwarding headers are untrusted. */
export const isLoopbackAddress = (address: string | undefined) =>
  ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address ?? '');

/** URL has already normalized dot segments; filtering makes repeated slashes unambiguous. */
export const isLocalAdminPath = (pathname: string) => {
  const parts = pathname.split('/').filter(Boolean);
  return parts[0] === 'api' && parts[1] === 'admin';
};

export const mustRestrictLocalAdmin = (pathname: string, socketAddress: string | undefined) =>
  isLocalAdminPath(pathname) && !isLoopbackAddress(socketAddress);
