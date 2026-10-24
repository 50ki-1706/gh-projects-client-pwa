import { auth } from "void/client";
import { projectSessionUser, type User } from "../src/client/session";

type IsAny<T> = 0 extends (1 & T) ? true : false;
const projectionIsTyped: IsAny<ReturnType<typeof projectSessionUser>> = false;
void projectionIsTyped;

// This is the generic browser envelope, not void/auth's server ALS session.
async function genericSessionContract() {
  const result: unknown = await auth.getSession();
  const user: User | null = projectSessionUser(result);
  if (user) {
    const name: string = user.name;
    const image: string | null = user.image;
    void name;
    void image;
  }
  // @ts-expect-error Unvalidated upstream data is unknown, not trusted profile data.
  void result.data;
  // @ts-expect-error No GitHub access token is exposed in the UI projection.
  void user?.accessToken;
}
void genericSessionContract;
