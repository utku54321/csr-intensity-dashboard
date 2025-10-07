import React from "react";

type CardProps = React.HTMLAttributes<HTMLDivElement>;

export const Card: React.FC<CardProps> = ({ className = "", ...props }) => (
  <div className={`rounded-lg border ${className}`} {...props} />
);
