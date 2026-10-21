import { signOutAction } from "@/app/admin/actions";
import { Button } from "@/components/ui/Button";
import { ka } from "@/content/ka";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant="secondary" size="sm">
        {ka.admin.signOut}
      </Button>
    </form>
  );
}
