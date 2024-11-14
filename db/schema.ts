import { pgTable, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  username: text("username").unique().notNull(),
  password: text("password").notNull(),
  points: integer("points").notNull().default(0),
});

export const guest_preferences = pgTable("guest_preferences", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  guest_id: text("guest_id").unique().notNull(),
  session_id: text("session_id").notNull(),
  guest_username: text("guest_username").notNull(),
  preferences: jsonb("preferences").notNull().default({}),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const channels = pgTable("channels", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").unique().notNull(),
  description: text("description").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
  created_by: integer("created_by").notNull().references(() => users.id),
});

export const posts = pgTable("posts", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  user_id: integer("user_id").notNull().references(() => users.id),
  username: text("username").notNull(),
  audio_url: text("audio_url").notNull(),
  duration: integer("duration").notNull(),
  transcript: text("transcript"),
  channel_id: integer("channel_id").references(() => channels.id),
  parent_id: integer("parent_id").references(() => posts.id),
  likes: integer("likes").array(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users);
export const selectUserSchema = createSelectSchema(users);
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = z.infer<typeof selectUserSchema>;

export const insertGuestPreferencesSchema = createInsertSchema(guest_preferences);
export const selectGuestPreferencesSchema = createSelectSchema(guest_preferences);
export type InsertGuestPreferences = z.infer<typeof insertGuestPreferencesSchema>;
export type GuestPreferences = z.infer<typeof selectGuestPreferencesSchema>;

export const insertChannelSchema = createInsertSchema(channels);
export const selectChannelSchema = createSelectSchema(channels);
export type InsertChannel = z.infer<typeof insertChannelSchema>;
export type Channel = z.infer<typeof selectChannelSchema>;

export const insertPostSchema = createInsertSchema(posts);
export const selectPostSchema = createSelectSchema(posts);
export type InsertPost = z.infer<typeof insertPostSchema>;
export type Post = z.infer<typeof selectPostSchema>;