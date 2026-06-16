import type { Profile } from "./types";
import { Dropdown } from "./Dropdown";

type Props = {
  profiles: Profile[];
  activeProfile: string | null;
  setActiveProfile: (profileId: string | null) => void;
};

// Sidebar profile selector. A thin wrapper over the shared Dropdown that maps
// the empty-string "All profiles" option to/from a null active profile.
export function ProfileSwitcher({ profiles, activeProfile, setActiveProfile }: Props) {
  const options = [
    { value: "", label: "All profiles" },
    ...profiles.map((profile) => ({ value: profile.id, label: profile.name }))
  ];

  return (
    <Dropdown
      variant="toolbar"
      ariaLabel="Active profile"
      value={activeProfile ?? ""}
      options={options}
      onChange={(value) => setActiveProfile(value || null)}
    />
  );
}
