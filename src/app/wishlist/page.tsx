import { Wishlist } from '@/components/Wishlist'
import { getMembers, getWishlist } from '@/lib/data'

export const dynamic = 'force-dynamic'

export default async function WishlistPage() {
  const [members, items] = await Promise.all([getMembers(), getWishlist()])
  return <Wishlist items={items} members={members} />
}
