import { useAuth } from '../context/AuthContext'
import CategoryManager from '../components/CategoryManager'

/** Shop Settings → Categories. */
export default function Categories() {
  const { shopId } = useAuth()
  return (
    <div>
      <CategoryManager shopId={shopId} />
    </div>
  )
}
